import { z } from 'zod';

export const jobDetailRoutePath = 'jobs/$jobId';
export const jobDetailRouteId = '/console/jobs/$jobId';

export const jobDetailSearchSchema = z.object({
	engine: z.string().optional(),
	sideChat: z.string().optional(),
});
