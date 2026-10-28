'use strict';

// lodash fallback used only when the real dependency is not installed
const cloneDeep = value => {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
};
const flatten = arrays => {
  return (arrays || []).reduce((acc, item) => acc.concat(item), []);
};
const map = (collection, prop) => {
  return (collection || []).map(item => {
    return typeof prop === 'function' ? prop(item) : item?.[prop];
  });
};
const shuffle = array => {
  const result = (array || []).slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const extend = (target, ...sources) => Object.assign(target, ...sources);

module.exports = { cloneDeep, flatten, map, shuffle, extend };
