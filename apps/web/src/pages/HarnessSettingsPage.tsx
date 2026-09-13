import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
	type Backend,
	HARNESS_NAMES,
	harnessesQueryOptions,
	isBackend,
} from '@/lib/harnesses';
import { orpc } from '@/lib/orpc';

export function HarnessSettingsPage() {
	const params = useParams({ from: '/settings/harnesses/$backend' });
	const backend = isBackend(params.backend) ? params.backend : undefined;
	const queryClient = useQueryClient();
	const [codexHome, setCodexHome] = useState('');

	const harnessesQuery = useQuery(harnessesQueryOptions());
	const codexHomeQuery = useQuery({
		queryKey: ['settings', 'codexHome'],
		queryFn: () => orpc.settings.getCodexHome(),
		enabled: backend === 'codex',
	});

	const checkMutation = useMutation({
		mutationFn: (input: { backend: Backend }) => orpc.harnesses.check(input),
	});
	const codexHomeMutation = useMutation({
		mutationFn: (home: string | undefined) =>
			orpc.settings.setCodexHome({ home }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['settings', 'codexHome'] });
			queryClient.invalidateQueries({ queryKey: ['models', 'codex'] });
		},
	});

	useEffect(() => {
		if (backend === undefined) return;
		checkMutation.reset();
	}, [backend, checkMutation.reset]);

	useEffect(() => {
		if (codexHomeQuery.data === undefined) return;
		setCodexHome(
			codexHomeQuery.data.home === undefined ? '' : codexHomeQuery.data.home,
		);
	}, [codexHomeQuery.data]);

	const harness = harnessesQuery.data?.find(
		(entry) => entry.backend === backend,
	);
	const title = backend === undefined ? 'Harness' : HARNESS_NAMES[backend];

	if (harnessesQuery.isLoading) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<PageHeader title={title} />
				<main className="flex-1 overflow-y-auto px-33 py-22">
					<div className="mx-auto max-w-[900px]">
						<p className="text-sm text-muted-foreground">Loading harness…</p>
					</div>
				</main>
			</div>
		);
	}

	if (
		harnessesQuery.isError ||
		harness === undefined ||
		backend === undefined
	) {
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				<PageHeader title={title} />
				<main className="flex-1 overflow-y-auto px-33 py-22">
					<div className="mx-auto max-w-[900px]">
						<p className="text-sm text-muted-foreground">
							{harnessesQuery.isError
								? 'Failed to load harnesses'
								: 'Harness not found'}
						</p>
					</div>
				</main>
			</div>
		);
	}

	const canSaveCodexHome =
		!codexHomeMutation.isPending && !codexHomeQuery.isLoading;

	function saveCodexHome() {
		if (!canSaveCodexHome) return;
		const trimmedHome = codexHome.trim();
		codexHomeMutation.mutate(trimmedHome === '' ? undefined : trimmedHome);
	}

	function clearCodexHome() {
		if (!canSaveCodexHome) return;
		setCodexHome('');
		codexHomeMutation.mutate(undefined);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<PageHeader title={title} />
			<main className="flex-1 overflow-y-auto px-33 py-22">
				<div className="mx-auto grid max-w-[900px] gap-8">
					<div className="grid max-w-xl gap-4">
						<Field>
							<FieldLabel htmlFor="harness-binary-path">Binary path</FieldLabel>
							<Input
								id="harness-binary-path"
								readOnly
								value={harness.binaryPath}
								className="font-mono text-xs"
								onFocus={(event) => event.currentTarget.select()}
							/>
							<FieldDescription>
								Detected executable used for ACP sessions.
							</FieldDescription>
						</Field>

						<div className="flex flex-col items-start gap-3">
							<Button
								type="button"
								disabled={checkMutation.isPending}
								onClick={() => {
									checkMutation.mutate({ backend });
								}}
							>
								{checkMutation.isPending ? (
									<>
										<Spinner />
										Checking…
									</>
								) : (
									'Check connection'
								)}
							</Button>

							{checkMutation.isSuccess && checkMutation.data.ok ? (
								<Alert className="border-verdant-accent/40">
									<AlertTitle>Connection successful</AlertTitle>
									<AlertDescription>
										{checkMutation.data.agentName !== undefined
											? checkMutation.data.agentName
											: 'ACP handshake completed'}
										{checkMutation.data.agentVersion !== undefined
											? ` · ${checkMutation.data.agentVersion}`
											: null}
									</AlertDescription>
								</Alert>
							) : checkMutation.isSuccess && !checkMutation.data.ok ? (
								<Alert variant="destructive">
									<AlertTitle>Connection failed</AlertTitle>
									<AlertDescription>
										{checkMutation.data.message}
									</AlertDescription>
								</Alert>
							) : checkMutation.isError ? (
								<Alert variant="destructive">
									<AlertTitle>Connection check failed</AlertTitle>
									<AlertDescription>
										{checkMutation.error.message}
									</AlertDescription>
								</Alert>
							) : null}
						</div>
					</div>

					{backend === 'codex' ? (
						<div className="grid max-w-xl gap-4 border-t border-border pt-8">
							<div>
								<h2 className="text-base font-medium text-foreground">
									Codex home
								</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									Configure the <code className="font-mono">CODEX_HOME</code>{' '}
									directory for newly started Codex sessions.
								</p>
							</div>
							{codexHomeQuery.isLoading ? (
								<p className="text-sm text-muted-foreground">
									Loading Codex home…
								</p>
							) : codexHomeQuery.isError ? (
								<p className="text-sm text-destructive">
									Failed to load Codex home
								</p>
							) : (
								<>
									<Field>
										<FieldLabel htmlFor="codex-home">Codex home</FieldLabel>
										<Input
											id="codex-home"
											value={codexHome}
											placeholder="~/.codex"
											onChange={(event) => setCodexHome(event.target.value)}
										/>
										<FieldDescription>
											Leave blank to use the default{' '}
											<code className="font-mono">~/.codex</code>. Changes apply
											to newly started Codex sessions.
										</FieldDescription>
									</Field>
									<div className="flex gap-2">
										<Button
											type="button"
											disabled={!canSaveCodexHome}
											onClick={saveCodexHome}
										>
											{codexHomeMutation.isPending ? 'Saving…' : 'Save'}
										</Button>
										<Button
											type="button"
											variant="outline"
											disabled={!canSaveCodexHome || codexHome === ''}
											onClick={clearCodexHome}
										>
											Clear
										</Button>
									</div>
									{codexHomeMutation.isError ? (
										<p className="text-sm text-destructive">
											{codexHomeMutation.error.message}
										</p>
									) : null}
								</>
							)}
						</div>
					) : null}
				</div>
			</main>
		</div>
	);
}

function PageHeader(props: { title: string }) {
	return (
		<header className="flex items-center justify-between border-b border-border px-22 py-15">
			<span className="text-subheading font-light text-foreground">
				{props.title}
			</span>
		</header>
	);
}
