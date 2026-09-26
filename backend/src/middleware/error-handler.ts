import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';
import type { AppLogger } from '../shared/logger.js';

/** Unknown routes answer with the documented envelope, never HTML (api.md §1). */
export function createNotFoundHandler(): RequestHandler {
  return (_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  };
}

/**
 * The single place errors become responses — architecture.md §8.
 * 4xx are expected traffic (logged at `warn`); anything untyped is a bug: logged with the
 * stack and request id, returned as a generic 500 that leaks nothing.
 */
export function createErrorHandler(logger: AppLogger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'The request is invalid.', details },
      });
      return;
    }

    if (error instanceof AppError) {
      const log = error.status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
      log(
        { code: error.code, status: error.status, requestId: req.id, path: req.originalUrl },
        error.message,
      );
      res.status(error.status).json(error.toEnvelope());
      return;
    }

    logger.error(
      { err: error, requestId: req.id, method: req.method, path: req.originalUrl },
      'Unhandled error',
    );
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL', message: 'Something went wrong on our side.' },
    });
  };
}
