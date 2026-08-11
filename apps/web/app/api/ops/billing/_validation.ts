import { z } from "zod";

export const ProjectBillingBodySchema = z.object({ projectId: z.string().uuid() }).strict();
