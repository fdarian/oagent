import { describe, expect, test } from 'bun:test';
import { splitShellWords } from './shell-words.ts';

describe('splitShellWords', () => {
	test.each([
		['', []],
		['   ', []],
		['agent', ['agent']],
		['agent --flag value', ['agent', '--flag', 'value']],
		['  agent \t --flag\n value ', ['agent', '--flag', 'value']],
		['agent "two words"', ['agent', 'two words']],
		["agent 'two words'", ['agent', 'two words']],
		['agent ""', ['agent', '']],
		["agent ''", ['agent', '']],
		['a"b c"d', ['ab cd']],
		['a\'b c\'"d e"', ['ab cd e']],
		['agent two\\ words', ['agent', 'two words']],
		['"say \\"hi\\""', ['say "hi"']],
		['"back\\\\slash"', ['back\\slash']],
		['"keeps \\n literal"', ['keeps \\n literal']],
		['\'no \\ escapes "here"\'', ['no \\ escapes "here"']],
		['"$HOME `x` $(y)" *', ['$HOME `x` $(y)', '*']],
		['agent --path=/a\\ b/c', ['agent', '--path=/a b/c']],
		['bunx @zed-industries/codex-acp', ['bunx', '@zed-industries/codex-acp']],
		['a \\\nb', ['a', 'b']],
		['"a\\\nb"', ['ab']],
	])('splits %j', (input, expected) => {
		expect(splitShellWords(input)).toEqual(expected);
	});

	test.each(['"open', "'open", 'trailing\\', 'a "b \\'])(
		'rejects %j',
		(input) => {
			expect(() => splitShellWords(input)).toThrow();
		},
	);
});
