import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { orpc } from '@/lib/orpc';

export function WorktreeSettingsPage() {
	const queryClient = useQueryClient();
	const [enabled, setEnabled] = useState(false);
	const [createCommand, setCreateCommand] = useState('');
	const setting = useQuery(orpc.settings.getWorktree.queryOptions());
	useEffect(() => {
		if (setting.data !== undefined) {
			setEnabled(setting.data.enabled);
			setCreateCommand(setting.data.createCommand);
		}
	}, [setting.data]);
	const save = useMutation(
		orpc.settings.setWorktree.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.settings.getWorktree.key(),
				});
			},
		}),
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="border-b border-border px-22 py-15 text-subheading font-light">
				Worktrees
			</header>
			<main className="flex-1 overflow-y-auto px-33 py-22">
				<div className="mx-auto grid max-w-[900px] gap-4">
					{setting.isLoading ? (
						<p>Loading…</p>
					) : setting.isError ? (
						<p className="text-destructive">Failed to load worktree settings</p>
					) : (
						<div className="grid max-w-xl gap-4">
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={enabled}
									onChange={(event) => setEnabled(event.target.checked)}
								/>{' '}
								Enable worktrees for new MCP sessions
							</label>
							<Field>
								<FieldLabel htmlFor="worktree-command">
									Create command
								</FieldLabel>
								<Input
									id="worktree-command"
									value={createCommand}
									onChange={(event) => setCreateCommand(event.target.value)}
									placeholder="wt switch -c {{branch}} -b {{base}}"
								/>
							</Field>
							<p className="text-sm text-muted-foreground">
								Available variables: <code>{'{{branch}}'}</code> (new branch),{' '}
								<code>{'{{base}}'}</code> (current branch),{' '}
								<code>{'{{repo}}'}</code> (repository root). Example:{' '}
								<code>
									wt switch -c {'{{branch}}'} -b {'{{base}}'}
								</code>
								. Created worktrees are left in place.
							</p>
							<div>
								<Button
									type="button"
									disabled={
										save.isPending || (enabled && createCommand.trim() === '')
									}
									onClick={() => save.mutate({ enabled, createCommand })}
								>
									{save.isPending ? 'Saving…' : 'Save'}
								</Button>
							</div>
							{save.isError && (
								<p className="text-sm text-destructive">{save.error.message}</p>
							)}
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
