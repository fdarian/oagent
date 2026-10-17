/**
 * Splits a command line into words the way a POSIX shell would for quoting
 * and escaping, without expanding anything: no variables, globs, or
 * substitution. Throws on an unterminated quote or a trailing backslash.
 */
export function splitShellWords(input: string): Array<string> {
	const words: Array<string> = [];
	let current = '';
	let inWord = false;
	let index = 0;
	const flush = () => {
		if (!inWord) return;
		words.push(current);
		current = '';
		inWord = false;
	};
	while (index < input.length) {
		const char = input.charAt(index);
		if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
			flush();
			index++;
			continue;
		}
		inWord = true;
		if (char === "'") {
			const end = input.indexOf("'", index + 1);
			if (end === -1) throw new Error('Unterminated single quote.');
			current += input.slice(index + 1, end);
			index = end + 1;
			continue;
		}
		if (char === '"') {
			index++;
			let closed = false;
			while (index < input.length) {
				const inner = input.charAt(index);
				if (inner === '"') {
					closed = true;
					index++;
					break;
				}
				const next = input.charAt(index + 1);
				if (inner === '\\' && index + 1 < input.length) {
					if (next === '"' || next === '\\' || next === '$' || next === '`') {
						current += next;
						index += 2;
						continue;
					}
					if (next === '\n') {
						index += 2;
						continue;
					}
				}
				current += inner;
				index++;
			}
			if (!closed) throw new Error('Unterminated double quote.');
			continue;
		}
		if (char === '\\') {
			if (index + 1 >= input.length) {
				throw new Error('Trailing backslash with nothing to escape.');
			}
			const next = input.charAt(index + 1);
			// A backslash-newline is a line continuation and contributes nothing.
			if (next !== '\n') current += next;
			index += 2;
			continue;
		}
		current += char;
		index++;
	}
	flush();
	return words;
}
