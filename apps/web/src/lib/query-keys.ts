export const queryKeys = {
	jobs: () => ['jobs'] as const,
	agents: () => ['agents'] as const,
	agentTargets: (backend: string) => ['agents', 'targets', backend] as const,
	job: (jobId: string) => ['jobs', jobId] as const,
	sideChats: (sourceJobId: string) => ['sideChats', sourceJobId] as const,
	harnesses: () => ['harnesses'] as const,
	harnessAuthStatus: (backend: string) =>
		['harnesses', 'auth', backend] as const,
	harnessEnv: (backend: string) => ['settings', 'harnessEnv', backend] as const,
};
