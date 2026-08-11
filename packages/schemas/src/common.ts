import { z } from "zod";

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PublicHttpUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  }, "Expected an HTTP(S) URL without embedded credentials");

export const IdentifierSchema = z.string().trim().min(1).max(160);
export const ShortTextSchema = z.string().trim().min(1).max(500);
export const LongTextSchema = z.string().trim().min(1).max(4_000);
export const ConfidenceSchema = z.number().finite().min(0).max(1);
export const PrioritySchema = z.number().int().min(0).max(100);

export const StringListSchema = z.array(z.string().trim().min(1).max(200)).max(50);
