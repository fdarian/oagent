import { z } from 'zod';

export const sessionSearchSchema = z.object({
	engine: z.string().optional(),
	sideChat: z.string().optional(),
});
