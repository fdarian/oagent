export const queryKeys = {
	jobs: () => ['jobs'] as const,
	harnesses: () => ['harnesses'] as const,
	harnessAuthStatus: (backend: string) =>
		['harnesses', 'auth', backend] as const,
	harnessEnv: (backend: string) => ['settings', 'harnessEnv', backend] as const,
};
