import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { DriverException } from "@mikro-orm/core";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (exception instanceof DriverException) {
      const status = this.determineHttpStatus(exception);
      response.status(status).json({
        statusCode: status,
        message: this.getUserFriendlyMessage(exception),
        code: exception.code,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        statusCode: status,
        message: exception.message,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private determineHttpStatus(exception: DriverException): number {
    if (exception.code === "23505") return HttpStatus.CONFLICT; // Unique violation
    if (exception.code === "23503") return HttpStatus.BAD_REQUEST; // Foreign key violation
    if (exception.code === "23502") return HttpStatus.BAD_REQUEST; // Not null violation
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getUserFriendlyMessage(exception: DriverException): string {
    if (exception.code === "23505") return "Duplicate entry";
    if (exception.code === "23503") return "Related entity not found";
    if (exception.code === "23502") return "Required field is missing";
    return "Database error occurred";
  }
}
