import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { HarnessEnvSection } from '@/components/harness-env-section';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
	HARNESS_NAMES,
	harnessAuthStatusQueryOptions,
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
	const codexHomeQuery = useQuery(
		orpc.settings.getCodexHome.queryOptions({
			enabled: backend === 'codex',
		}),
	);
	const transportQuery = useQuery(
		orpc.settings.getHarnessTransport.queryOptions({
			input: { backend: 'opencode' },
			enabled: backend === 'opencode',
		}),
	);
	const transportMutation = useMutation(
		orpc.settings.setHarnessTransport.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.settings.getHarnessTransport.key(),
				});
				checkMutation.reset();
			},
		}),
	);

	const checkMutation = useMutation(orpc.harnesses.check.mutationOptions());
	const startMutation = useMutation(
		orpc.harnesses.serviceStart.mutationOptions({
			onSuccess: () => checkMutation.mutate({ backend: 'opencode' }),
		}),
	);
	const stopMutation = useMutation(
		orpc.harnesses.serviceStop.mutationOptions({
			onSuccess: () => checkMutation.mutate({ backend: 'opencode' }),
		}),
	);
	useEffect(() => {
		if (backend === 'opencode' && transportQuery.data?.transport === 'api')
			checkMutation.mutate({ backend: 'opencode' });
	}, [backend, transportQuery.data?.transport, checkMutation.mutate]);
	const codexHomeMutation = useMutation(
		orpc.settings.setCodexHome.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.settings.getCodexHome.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.harnesses.authStatus.key({
						input: { backend: 'codex' },
					}),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.models.list.key({ input: { backend: 'codex' } }),
				});
			},
		}),
	);

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
	const trimmedCodexHome = codexHome.trim();
	const draftCodexHome = trimmedCodexHome === '' ? undefined : trimmedCodexHome;
	const isCodexHomeChanged = draftCodexHome !== codexHomeQuery.data?.home;
	const apiSupported =
		backend === 'opencode' &&
		harness.version !== undefined &&
		Number.parseInt(harness.version, 10) >= 2;
	const apiMode = apiSupported && transportQuery.data?.transport === 'api';

	function saveCodexHome() {
		if (!canSaveCodexHome || !isCodexHomeChanged) return;
		codexHomeMutation.mutate({ home: draftCodexHome });
	}

	function clearCodexHome() {
		if (!canSaveCodexHome) return;
		setCodexHome('');
		codexHomeMutation.mutate({ home: undefined });
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
							<FieldDescription>Detected harness executable.</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="harness-version">Version</FieldLabel>
							{harness.version !== undefined ? (
								<Input
									id="harness-version"
									readOnly
									value={harness.version}
									className="font-mono text-xs"
									onFocus={(event) => event.currentTarget.select()}
								/>
							) : (
								<p className="text-sm text-muted-foreground">Not detected</p>
							)}
							<FieldDescription>
								Version captured from the detected harness binary.
							</FieldDescription>
						</Field>
						{backend === 'opencode' ? (
							<Field>
								<FieldLabel>Transport</FieldLabel>
								<fieldset
									className="flex gap-2"
									aria-label="OpenCode transport"
								>
									{(['acp', 'api'] as const).map((transport) => (
										<Button
											key={transport}
											type="button"
											variant={
												(apiMode ? 'api' : 'acp') === transport
													? 'default'
													: 'outline'
											}
											disabled={
												transportQuery.isLoading ||
												transportMutation.isPending ||
												(transport === 'api' && !apiSupported)
											}
											onClick={() =>
												transportMutation.mutate({
													backend: 'opencode',
													transport,
												})
											}
										>
											{transport.toUpperCase()}
										</Button>
									))}
								</fieldset>
								{!apiSupported ? (
									<FieldDescription>
										API transport requires OpenCode v2 or newer.
									</FieldDescription>
								) : null}
								{transportQuery.isError ? (
									<p className="text-sm text-destructive">
										{transportQuery.error.message}
									</p>
								) : null}
								{transportMutation.isError ? (
									<p className="text-sm text-destructive">
										{transportMutation.error.message}
									</p>
								) : null}
							</Field>
						) : null}

						{apiMode ? (
							<div className="flex flex-col items-start gap-3">
								<p className="text-sm">
									{checkMutation.data?.ok && 'running' in checkMutation.data
										? checkMutation.data.running
											? `Running at ${checkMutation.data.url} · v${checkMutation.data.version}`
											: 'Stopped'
										: 'Status not checked'}
								</p>
								<div className="flex gap-2">
									<Button
										type="button"
										disabled={startMutation.isPending}
										onClick={() => startMutation.mutate()}
									>
										Start
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={stopMutation.isPending}
										onClick={() => stopMutation.mutate()}
									>
										Stop
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={checkMutation.isPending}
										onClick={() => checkMutation.mutate({ backend })}
									>
										Refresh
									</Button>
								</div>
								{startMutation.isError ||
								stopMutation.isError ||
								checkMutation.isError ? (
									<p className="text-sm text-destructive">
										{startMutation.error?.message ||
											stopMutation.error?.message ||
											checkMutation.error?.message}
									</p>
								) : null}
							</div>
						) : (
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
											{'agentName' in checkMutation.data &&
											checkMutation.data.agentName !== undefined
												? checkMutation.data.agentName
												: 'ACP handshake completed'}
											{'agentVersion' in checkMutation.data &&
											checkMutation.data.agentVersion !== undefined
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
						)}
					</div>

					{backend === 'codex' ? (
						<div className="grid max-w-xl gap-4 border-t border-border pt-8">
							<CodexAuthSection />

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
											disabled={!canSaveCodexHome || !isCodexHomeChanged}
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

					{!apiMode ? (
						<HarnessEnvSection key={backend} backend={backend} />
					) : null}
				</div>
			</main>
		</div>
	);
}

function CodexAuthSection() {
	const queryClient = useQueryClient();
	const previousAuthStatus = useRef<string | undefined>(undefined);
	const [loginPrompt, setLoginPrompt] = useState<
		{ verificationUrl: string; userCode: string } | undefined
	>(undefined);
	const authStatusQuery = useQuery(harnessAuthStatusQueryOptions('codex'));
	const loginMutation = useMutation(
		orpc.harnesses.login.mutationOptions({
			onSuccess: (result) => {
				if (result.status === 'pending') {
					setLoginPrompt({
						verificationUrl: result.verificationUrl,
						userCode: result.userCode,
					});
					queryClient.setQueryData(
						orpc.harnesses.authStatus.queryKey({ input: { backend: 'codex' } }),
						{
							backend: 'codex',
							status: 'pending',
						},
					);
					return;
				}
				queryClient.invalidateQueries({
					queryKey: orpc.harnesses.authStatus.key({
						input: { backend: 'codex' },
					}),
				});
			},
		}),
	);
	const cancelMutation = useMutation(
		orpc.harnesses.cancelLogin.mutationOptions({
			onSuccess: () => {
				setLoginPrompt(undefined);
				queryClient.invalidateQueries({
					queryKey: orpc.harnesses.authStatus.key({
						input: { backend: 'codex' },
					}),
				});
			},
		}),
	);
	const logoutMutation = useMutation(
		orpc.harnesses.logout.mutationOptions({
			onSuccess: () => {
				setLoginPrompt(undefined);
				queryClient.invalidateQueries({
					queryKey: orpc.harnesses.authStatus.key({
						input: { backend: 'codex' },
					}),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.models.list.key({ input: { backend: 'codex' } }),
				});
			},
		}),
	);

	useEffect(() => {
		const status = authStatusQuery.data?.status;
		if (previousAuthStatus.current === 'pending' && status === 'logged_in') {
			queryClient.invalidateQueries({
				queryKey: orpc.models.list.key({ input: { backend: 'codex' } }),
			});
		}
		if (status === 'logged_in') {
			setLoginPrompt(undefined);
		}
		if (status === 'logged_out' && !loginMutation.isPending) {
			setLoginPrompt(undefined);
		}
		previousAuthStatus.current = status;
	}, [authStatusQuery.data?.status, loginMutation.isPending, queryClient]);

	const status = authStatusQuery.data?.status;
	const authStatus = authStatusQuery.data;
	const isLoginBusy =
		loginMutation.isPending ||
		cancelMutation.isPending ||
		logoutMutation.isPending;

	return (
		<div className="grid gap-4 border-b border-border pb-8">
			<div>
				<h2 className="text-base font-medium text-foreground">Codex login</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Authentication for the currently effective{' '}
					<code className="font-mono">CODEX_HOME</code>.
				</p>
			</div>

			{authStatusQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">
					Checking Codex login status…
				</p>
			) : authStatusQuery.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not check login status</AlertTitle>
					<AlertDescription>{authStatusQuery.error.message}</AlertDescription>
				</Alert>
			) : authStatus?.status === 'logged_in' ? (
				<div className="flex flex-col items-start gap-3">
					<div className="flex items-center gap-2">
						<Badge variant="outline">Logged in</Badge>
						{authStatus.method !== undefined ? (
							<span className="text-sm text-muted-foreground">
								via {authStatus.method}
							</span>
						) : null}
					</div>
					<Button
						type="button"
						variant="outline"
						disabled={isLoginBusy}
						onClick={() => logoutMutation.mutate({ backend: 'codex' })}
					>
						{logoutMutation.isPending ? (
							<>
								<Spinner />
								Logging out…
							</>
						) : (
							'Log out'
						)}
					</Button>
				</div>
			) : status === 'pending' ? (
				<div className="grid gap-3">
					<Alert>
						<AlertTitle>Login is waiting for confirmation</AlertTitle>
						<AlertDescription>
							{loginPrompt === undefined ? (
								'Complete the Codex device login if it is still open.'
							) : (
								<div className="grid gap-3">
									<a
										href={loginPrompt.verificationUrl}
										target="_blank"
										rel="noreferrer"
										className="text-primary underline underline-offset-4"
									>
										Open the Codex login page
									</a>
									<Field>
										<FieldLabel htmlFor="codex-login-code">
											Device code
										</FieldLabel>
										<Input
											id="codex-login-code"
											readOnly
											value={loginPrompt.userCode}
											className="font-mono"
											onFocus={(event) => event.currentTarget.select()}
										/>
									</Field>
								</div>
							)}
						</AlertDescription>
					</Alert>
					<Button
						type="button"
						variant="outline"
						disabled={isLoginBusy}
						onClick={() => cancelMutation.mutate({ backend: 'codex' })}
					>
						{cancelMutation.isPending ? 'Cancelling…' : 'Cancel login'}
					</Button>
				</div>
			) : status === 'unsupported' ? (
				<Alert>
					<AlertTitle>Login is unavailable</AlertTitle>
					<AlertDescription>
						The Codex CLI is not available on the engine host.
					</AlertDescription>
				</Alert>
			) : (
				<div className="flex flex-col items-start gap-3">
					<Badge variant="outline">Logged out</Badge>
					<Button
						type="button"
						disabled={isLoginBusy}
						onClick={() => loginMutation.mutate({ backend: 'codex' })}
					>
						{loginMutation.isPending ? (
							<>
								<Spinner />
								Starting login…
							</>
						) : (
							'Log in'
						)}
					</Button>
				</div>
			)}

			{loginMutation.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Login failed</AlertTitle>
					<AlertDescription>{loginMutation.error.message}</AlertDescription>
				</Alert>
			) : null}
			{cancelMutation.isError || logoutMutation.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Could not update login</AlertTitle>
					<AlertDescription>
						{cancelMutation.isError
							? cancelMutation.error.message
							: logoutMutation.isError
								? logoutMutation.error.message
								: null}
					</AlertDescription>
				</Alert>
			) : null}
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
