import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
	type Backend,
	HARNESS_NAMES,
	harnessAuthStatusQueryOptions,
	harnessesQueryOptions,
	isBackend,
} from '@/lib/harnesses';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';

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
			queryClient.invalidateQueries({
				queryKey: queryKeys.harnessAuthStatus('codex'),
			});
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

function CodexAuthSection() {
	const queryClient = useQueryClient();
	const previousAuthStatus = useRef<string | undefined>(undefined);
	const [loginPrompt, setLoginPrompt] = useState<
		{ verificationUrl: string; userCode: string } | undefined
	>(undefined);
	const authStatusQuery = useQuery(harnessAuthStatusQueryOptions('codex'));
	const loginMutation = useMutation({
		mutationFn: () => orpc.harnesses.login({ backend: 'codex' }),
		onSuccess: (result) => {
			if (result.status === 'pending') {
				setLoginPrompt({
					verificationUrl: result.verificationUrl,
					userCode: result.userCode,
				});
				queryClient.setQueryData(queryKeys.harnessAuthStatus('codex'), {
					backend: 'codex',
					status: 'pending',
				});
				return;
			}
			queryClient.invalidateQueries({
				queryKey: queryKeys.harnessAuthStatus('codex'),
			});
		},
	});
	const cancelMutation = useMutation({
		mutationFn: () => orpc.harnesses.cancelLogin({ backend: 'codex' }),
		onSuccess: () => {
			setLoginPrompt(undefined);
			queryClient.invalidateQueries({
				queryKey: queryKeys.harnessAuthStatus('codex'),
			});
		},
	});
	const logoutMutation = useMutation({
		mutationFn: () => orpc.harnesses.logout({ backend: 'codex' }),
		onSuccess: () => {
			setLoginPrompt(undefined);
			queryClient.invalidateQueries({
				queryKey: queryKeys.harnessAuthStatus('codex'),
			});
			queryClient.invalidateQueries({ queryKey: ['models', 'codex'] });
		},
	});

	useEffect(() => {
		const status = authStatusQuery.data?.status;
		if (previousAuthStatus.current === 'pending' && status === 'logged_in') {
			queryClient.invalidateQueries({ queryKey: ['models', 'codex'] });
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
						onClick={() => logoutMutation.mutate()}
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
						onClick={() => cancelMutation.mutate()}
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
						onClick={() => loginMutation.mutate()}
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
