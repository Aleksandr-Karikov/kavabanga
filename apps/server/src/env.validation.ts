import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  REDIS_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  COOKIE_SECRET: Joi.string().required(),

  REFRESH_TOKEN_STORE_PREFIX: Joi.string().optional(),
  REFRESH_TOKEN_TTL_SECONDS: Joi.number()
    .optional()
    .default(5 * 60),
  TOKEN_EVENTS_ENABLED: Joi.bool().optional(),
  TOKEN_VALIDATION_ENABLED: Joi.bool().optional(),
});
