'use strict';

// In-memory Firestore stand-in for offline regression tests. Supports the
// doc/collection/get/set/update/create/delete surface the code uses plus
// runTransaction, and records write invocations and completions so tests
// can assert writes actually landed (and that awaited writes were awaited).

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isSentinel(value) {
  return !!value && typeof value === 'object' && '__sentinel' in value;
}

function sameValue(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// array sentinels may carry a single value (value) or several variadic
// values (values); compare with deep equality so arrayUnion of an object
// dedupes the way Firestore does
function sentinelValues(value) {
  return value.values !== undefined ? value.values : [value.value];
}

function resolveValue(oldValue, value) {
  if (isSentinel(value)) {
    const old = Array.isArray(oldValue) ? oldValue : [];
    switch (value.__sentinel) {
      case 'arrayUnion': {
        const next = old.slice();
        for (const item of sentinelValues(value)) {
          if (!next.some(existing => sameValue(existing, item))) {
            next.push(item);
          }
        }
        return next;
      }
      case 'arrayRemove':
        return old.filter(item =>
            !sentinelValues(value).some(v => sameValue(v, item)));
      case 'increment':
        return (typeof oldValue === 'number' ? oldValue : 0) + value.value;
      case 'serverTimestamp':
        return Date.now();
      case 'delete':
        return DELETE_FIELD;
      default:
        return value;
    }
  }
  return value;
}

const DELETE_FIELD = Symbol('delete');

// real Firestore rejects documents containing arrays inside arrays; mirror
// that on every write so a codec regression (e.g. storing wire rosters
// directly) fails the fake the same way it would a real document. FieldValue
// sentinel payloads are skipped — their element lists are array contents,
// not nested array fields.
function assertNoNestedArrays(value, trail = 'root') {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (Array.isArray(item)) {
        throw new Error(
            `Firestore write rejected: nested array at ${trail}`);
      }
      assertNoNestedArrays(item, trail);
    }
    return;
  }
  if (value && typeof value === 'object') {
    if (value.__sentinel) {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assertNoNestedArrays(child, `${trail}.${key}`);
    }
  }
}

// apply an update payload, resolving dot-separated field paths and
// FieldValue sentinels; the delete sentinel removes the leaf key
function applyUpdate(target, data) {
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.');
    let node = target;
    while (parts.length > 1) {
      const part = parts.shift();
      if (typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {};
      }
      node = node[part];
    }
    const resolved = resolveValue(node[parts[0]], value);
    if (resolved === DELETE_FIELD) {
      delete node[parts[0]];
    } else {
      node[parts[0]] = resolved;
    }
  }
  return target;
}

class FakeDocSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this._data = data;
  }
  get exists() {
    return this._data !== undefined;
  }
  data() {
    return clone(this._data);
  }
}

class FakeDocRef {
  constructor(db, path) {
    this.db = db;
    this.path = path;
    this.id = path.split('/').pop();
    this.parent = new FakeCollectionRef(db, path.split('/').slice(0, -1).join('/'));
  }
  collection(name) {
    return new FakeCollectionRef(this.db, `${this.path}/${name}`);
  }
  get() {
    return Promise.resolve(this.db._snapshot(this.path, this));
  }
  set(data) {
    this.db._write(this.path, data, 'set');
    return this.db._delay(this.path);
  }
  update(data) {
    // like the real SDK, updating a missing doc rejects rather than creates
    if (!this.db._has(this.path)) {
      return Promise.reject(
          new Error(`update on nonexistent doc ${this.path}`));
    }
    this.db._write(this.path, data, 'update');
    return this.db._delay(this.path);
  }
  create(data) {
    if (this.db._has(this.path)) {
      return Promise.reject(new Error('document already exists'));
    }
    this.db._write(this.path, data, 'create');
    return this.db._delay(this.path);
  }
  delete() {
    this.db._delete(this.path);
    return this.db._delay(this.path);
  }
}

function getField(data, field) {
  return field.split('.').reduce(
      (node, part) => (node === null || node === undefined) ?
          undefined : node[part],
      data);
}

function matchesFilter(data, [field, op, value]) {
  const actual = getField(data, field);
  switch (op) {
    case '==': return sameValue(actual, value);
    case '!=': return !sameValue(actual, value);
    case '>': return actual > value;
    case '>=': return actual >= value;
    case '<': return actual < value;
    case '<=': return actual <= value;
    case 'in': return Array.isArray(value) &&
        value.some(v => sameValue(v, actual));
    case 'array-contains': return Array.isArray(actual) &&
        actual.some(item => sameValue(item, value));
    default: throw new Error(`unsupported query operator ${op}`);
  }
}

class FakeQuery {
  constructor(db, path, filters = [], orders = [], limitN = null) {
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.orders = orders;
    this.limitN = limitN;
  }
  doc(id) {
    return new FakeDocRef(this.db, `${this.path}/${id}`);
  }
  where(field, op, value) {
    return new FakeQuery(
        this.db, this.path, [...this.filters, [field, op, value]],
        this.orders, this.limitN);
  }
  orderBy(field, dir = 'asc') {
    return new FakeQuery(this.db, this.path, this.filters,
        [...this.orders, [field, dir]], this.limitN);
  }
  limit(n) {
    return new FakeQuery(
        this.db, this.path, this.filters, this.orders, n);
  }
  get() {
    const prefix = `${this.path}/`;
    const docs = [];
    for (const [docPath, data] of this.db.docs) {
      if (docPath.startsWith(prefix) &&
          !docPath.slice(prefix.length).includes('/') &&
          this.filters.every(filter => matchesFilter(data, filter))) {
        docs.push(new FakeDocSnapshot(
            this.doc(docPath.split('/').pop()), data));
      }
    }
    if (this.orders.length) {
      // a single lexicographic comparator: the first orderBy field is the
      // primary key, later fields only break ties (repeatedly sorting by
      // one field at a time would make the LAST key dominant instead)
      docs.sort((a, b) => {
        for (const [field, dir] of this.orders) {
          const av = getField(a.data(), field);
          const bv = getField(b.data(), field);
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          if (cmp) return dir === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }
    const limited = this.limitN === null ? docs : docs.slice(0, this.limitN);
    return Promise.resolve({docs: limited, empty: limited.length === 0});
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(db, path) {
    super(db, path);
    // the parent document of a collection path is the path one segment up,
    // or null for root collections
    const parentPath = path.split('/').slice(0, -1).join('/');
    this.parent = parentPath ? new FakeDocRef(db, parentPath) : null;
  }
  add(data) {
    // Firestore's add() creates a doc under a generated auto-id
    const ref = this.doc(`auto_${this.db.docs.size}_${Date.now()}`);
    return ref.create(data).then(() => ref);
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.writes = [];
    this.wrote = false;
  }
  get(ref) {
    // real Firestore transactions require all reads before all writes
    if (this.wrote) {
      return Promise.reject(
          new Error('transaction reads must come before writes'));
    }
    if (ref instanceof FakeQuery) {
      return ref.get();
    }
    return Promise.resolve(this.db._snapshot(ref.path, ref));
  }
  update(ref, data) {
    this.wrote = true;
    this.writes.push({path: ref.path, data, op: 'update'});
  }
  set(ref, data) {
    this.wrote = true;
    this.writes.push({path: ref.path, data, op: 'set'});
  }
  create(ref, data) {
    this.wrote = true;
    this.writes.push({path: ref.path, data, op: 'create'});
  }
  delete(ref) {
    this.wrote = true;
    this.writes.push({path: ref.path, op: 'delete'});
  }
}

class FakeFirestore {
  constructor() {
    this.docs = new Map();          // path -> document data
    this.invocations = [];          // every recorded write {path, op, data}
    this.completedWrites = [];      // writes whose promise has resolved
    this.delays = new Map();        // path substring -> artificial ms delay
    this._txTail = Promise.resolve();  // serializes concurrent transactions
  }

  collection(name) {
    return new FakeCollectionRef(this, name);
  }

  doc(path) {
    return new FakeDocRef(this, path);
  }

  // transactions run serially against this fake: a second transaction only
  // starts after the first commits, so a concurrent caller always observes
  // the post-commit state (Firestore would force a re-read/retry instead)
  runTransaction(fn) {
    const run = () => {
      const tx = new FakeTransaction(this);
      return Promise.resolve()
          .then(() => fn(tx))
          .then(result => {
            // validate every staged write before publishing anything so a
            // bad op can never leave partially applied state
            for (const write of tx.writes) {
              if (write.op !== 'delete') {
                assertNoNestedArrays(write.data, write.path);
              }
              const exists = this.docs.has(write.path);
              if (write.op === 'update' && !exists) {
                throw new Error(`update on nonexistent doc ${write.path}`);
              }
              if (write.op === 'create' && exists) {
                throw new Error(`create on existing doc ${write.path}`);
              }
            }
            for (const write of tx.writes) {
              if (write.op === 'delete') {
                this._delete(write.path);
              } else {
                this._write(write.path, write.data, write.op);
              }
            }
            return result;
          });
    };
    const result = this._txTail.then(run, run);
    this._txTail = result.then(() => {}, () => {});
    return result;
  }

  // staged writes publish atomically like a transaction commit: an op that
  // would fail rejects the whole batch before any write is recorded
  batch() {
    const db = this;
    const staged = [];
    return {
      set: (ref, data) => {
        staged.push({path: ref.path, data, op: 'set'});
      },
      update: (ref, data) => {
        staged.push({path: ref.path, data, op: 'update'});
      },
      create: (ref, data) => {
        staged.push({path: ref.path, data, op: 'create'});
      },
      delete: ref => {
        staged.push({path: ref.path, op: 'delete'});
      },
      commit() {
        try {
          for (const write of staged) {
            if (write.op !== 'delete') {
              assertNoNestedArrays(write.data, write.path);
            }
            const exists = db.docs.has(write.path);
            if (write.op === 'update' && !exists) {
              return Promise.reject(
                  new Error(`update on nonexistent doc ${write.path}`));
            }
            if (write.op === 'create' && exists) {
              return Promise.reject(
                  new Error(`create on existing doc ${write.path}`));
            }
          }
        } catch (e) {
          return Promise.reject(e);
        }
        for (const write of staged) {
          if (write.op === 'delete') {
            db._delete(write.path);
          } else {
            db._write(write.path, write.data, write.op);
          }
        }
        return Promise.resolve();
      },
    };
  }

  // find every write invocation whose path matches a substring
  writesTo(substring) {
    return this.invocations.filter(write => write.path.includes(substring));
  }

  completionsFor(substring) {
    return this.completedWrites.filter(write => write.path.includes(substring));
  }

  dataAt(path) {
    return clone(this.docs.get(path));
  }

  _has(path) {
    return this.docs.has(path);
  }

  _snapshot(path, ref) {
    return new FakeDocSnapshot(ref, this.docs.get(path));
  }

  _write(path, data, op) {
    assertNoNestedArrays(data, path);
    this.invocations.push({path, op, data: clone(data)});
    if (op === 'set' || op === 'create') {
      this.docs.set(path, clone(data));
    } else {
      this.docs.set(path, applyUpdate(this.docs.get(path) ?? {}, clone(data)));
    }
  }

  _delete(path) {
    this.invocations.push({path, op: 'delete'});
    this.docs.delete(path);
  }

  _delay(path) {
    return new Promise(resolve => {
      setTimeout(() => {
        this.completedWrites.push({path});
        resolve();
      }, this._delayFor(path));
    });
  }

  _delayFor(path) {
    for (const [match, ms] of this.delays) {
      if (path.includes(match)) {
        return ms;
      }
    }
    return 0;
  }
}

module.exports = {FakeFirestore};
