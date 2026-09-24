import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { listTool } from './list.ts';

describe('list tool', () => {
	test('renders the latest jobs for the current MCP session', async () => {
		let requestedMcpSessionId: string | undefined;
		const response = await Effect.runPromise(
			listTool.handle(
				{},
				{
					mcpSessionId: 'mcp-1',
					sessions: {
						list: (input) => {
							requestedMcpSessionId = input.mcpSessionId;
							return Effect.succeed([
								{
									id: 'session-1',
									jobId: 'job-2',
									status: 'done',
									prompt: 'Follow up\nwith tests',
									createdAt: Date.parse('2026-09-23T12:00:00.000Z'),
								},
							]);
						},
					} as Pick<Sessions['Service'], 'list'>,
				},
			),
		);

		expect(requestedMcpSessionId).toBe('mcp-1');
		expect(response.content[0]?.text).toBe(
			'# Sessions (1)\n\n- **session-1** [done] 2026-09-23T12:00:00.000Z · latest job `job-2`\n  Follow up with tests',
		);
		expect(response).not.toHaveProperty('structuredContent');
	});
});
