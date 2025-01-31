import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { format } from 'date-fns';

import { ErrorResponse } from '../interceptors/response-error.interceptor';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = host.switchToHttp().getResponse();
    const request = ctx.getRequest();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception.getResponse();
    const errorMessage =
      typeof exceptionResponse === 'object' && 'message' in exceptionResponse
        ? exceptionResponse['message']
        : exception.message;

    const finalRes: ErrorResponse = {
      status: false,
      path: request.url,
      statusCode,
      error: errorMessage,
      timestamp: format(new Date().toISOString(), 'yyyy-MM-dd HH:mm:ss'),
    };

    return response.code(statusCode).send(finalRes);
  }
}
