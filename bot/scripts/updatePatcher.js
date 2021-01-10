/* Returns a new array created by patching the diff into the old array.
	 * The diff formatted with alternating matching and mismatching segments:
	 * <Number of matching elements>
	 * <Number of mismatching elements>
	 * <The mismatching elements>
	 * ... repeated until the end of diff.
	 * Example 1: patching a diff of [1, 1, 3] onto [0, 0] yields [0, 3].
	 * Example 2: patching a diff of [0, 1, 2, 1] onto [0, 0] yields [2, 0].
	 */
module.exports = function(old, diff) {
	let out = [];
	let i = 0;
	while (i < diff.length) {
		if (diff[i]) {  // matching
			Array.prototype.push.apply(out, old.slice(out.length, out.length + diff[i]));
		}
		i++;
		if (i < diff.length && diff[i]) {  // mismatching
			Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]));
			i += diff[i];
		}
		i++;
	}
	return out;
}