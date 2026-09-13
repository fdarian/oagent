export const queryKeys = {
	jobs: () => ['jobs'] as const,
	harnesses: () => ['harnesses'] as const,
	harnessAuthStatus: (backend: string) =>
		['harnesses', 'auth', backend] as const,
};
