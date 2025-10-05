import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { DriverException } from "@mikro-orm/core";
import { FastifyReply, FastifyRequest } from "fastify";

interface ExceptionResponse {
  message?: string | string[];
  error?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : "Unknown error"}`,
        exception instanceof Error ? exception.stack : undefined
      );
    }

    if (exception instanceof DriverException) {
      const status = this.determineHttpStatus(exception);
      return response.status(status).send({
        statusCode: status,
        message: this.getUserFriendlyMessage(exception),
        code: exception.code,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message = this.extractMessageFromException(exceptionResponse);

      return response.status(status).send({
        statusCode: status,
        message: message,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private determineHttpStatus(exception: DriverException): number {
    if (exception.code === "23505") return HttpStatus.CONFLICT;
    if (exception.code === "23503") return HttpStatus.BAD_REQUEST;
    if (exception.code === "23502") return HttpStatus.BAD_REQUEST;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getUserFriendlyMessage(exception: DriverException): string {
    if (exception.code === "23505") return "Duplicate entry";
    if (exception.code === "23503") return "Related entity not found";
    if (exception.code === "23502") return "Required field is missing";
    return "Database error occurred";
  }

  private extractMessageFromException(
    exceptionResponse: string | object
  ): string {
    if (typeof exceptionResponse === "string") {
      return exceptionResponse;
    }

    if (this.isExceptionResponse(exceptionResponse)) {
      if (Array.isArray(exceptionResponse.message)) {
        return exceptionResponse.message.join(", ");
      }
      return exceptionResponse.message || "Error occurred";
    }

    return "Error occurred";
  }

  private isExceptionResponse(obj: unknown): obj is ExceptionResponse {
    return (
      typeof obj === "object" &&
      obj !== null &&
      ("message" in obj || "error" in obj)
    );
  }
}
