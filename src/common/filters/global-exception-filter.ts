import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { UniqueConstraintViolationException, ValidationError } from "@mikro-orm/core";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  
  
  private extractFieldName = (constraintName: string): string => {
    const match = constraintName.match(/_([^_]+)_unique$/);
    return match ? match[1] : constraintName;
  };

  private isSquareError(exception: any): boolean {
  return (
    exception?.name === 'ApiError' ||
    exception?.statusCode !== undefined ||
    exception?.result?.errors !== undefined ||
    exception?.constructor?.name === 'ApiError'
  );
}

// ── Helper: Extract Square error details ──────────────────────────
private parseSquareError(exception: any): {
  statusCode: number;
  errors: Array<{ category: string; code: string; detail?: string; field?: string }>;
} {
  // Square v40 SDK throws ApiError with statusCode and result.errors
  const statusCode = exception.statusCode || 500;
  const errors = exception.result?.errors || exception.errors || [];
  
  return { statusCode, errors };
}

// ── Helper: Map Square HTTP status to NestJS status ─────────────
private mapSquareStatusCode(statusCode: number): HttpStatus {
  switch (statusCode) {
    case 400: return HttpStatus.BAD_REQUEST;
    case 401: return HttpStatus.INTERNAL_SERVER_ERROR;
    case 402: return HttpStatus.BAD_REQUEST; // Payment errors
    case 403: return HttpStatus.FORBIDDEN;
    case 404: return HttpStatus.NOT_FOUND;
    case 409: return HttpStatus.CONFLICT;
    case 429: return HttpStatus.TOO_MANY_REQUESTS;
    case 500:
    case 502:
    case 503:
    case 504: return HttpStatus.SERVICE_UNAVAILABLE;
    default: return HttpStatus.BAD_REQUEST;
  }
}

// ── Helper: Map specific Square error codes to messages ─────────
private mapSquareErrorMessage(code: string, detail?: string): string {
  const errorMap: Record<string, string> = {
    CARD_DECLINED: "Your card was declined. Please try a different card.",
    INSUFFICIENT_FUNDS: "Your card has insufficient funds. Please try a different card.",
    INVALID_CARD: "The card details are invalid. Please check and try again.",
    INVALID_EXPIRATION: "The card expiration date is invalid.",
    INVALID_EXPIRATION_YEAR: "The card expiration year is invalid.",
    INVALID_EXPIRATION_MONTH: "The card expiration month is invalid.",
    INVALID_NUMBER: "The card number is invalid.",
    INVALID_CVV: "The CVV is invalid.",
    UNSUPPORTED_CARD_BRAND: "This card brand is not supported.",
    UNSUPPORTED_CARD_TYPE: "This card type is not supported.",
    VERIFY_CVV_FAILURE: "CVV verification failed.",
    VERIFY_AVS_FAILURE: "Address verification failed.",
    CARD_TOKEN_EXPIRED: "The card token has expired. Please re-enter your card details.",
    CARD_TOKEN_USED: "This card token has already been used.",
    AMOUNT_TOO_SMALL: "The payment amount is too small.",
    AMOUNT_TOO_LARGE: "The payment amount exceeds the allowed limit.",
    CURRENCY_MISMATCH: "The currency is not supported for this payment.",
    IDEMPOTENCY_KEY_REUSED: "This request was already processed. Please try again.",
    RESOURCE_NOT_FOUND: "The requested payment resource was not found.",
    MERCHANT_NOT_FOUND: "Payment configuration error. Please contact support.",
    UNAUTHORIZED: "Payment configuration error. Please contact support.",
  };

  return errorMap[code] || detail || "Payment request error";
}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = "Internal server error";
    let exceptionResponse: any;
    let squareCode: string | undefined = undefined;

    // 1) NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      exceptionResponse = exception.getResponse();
      console.log({status, exceptionResponse})
      message =
        typeof exceptionResponse === "string"
          ? exceptionResponse
          : (exceptionResponse as any).message;
    }

    // 2) Stripe errors
   else if (this.isSquareError(exception)) {
      const { statusCode, errors } = this.parseSquareError(exception);
      const firstError = errors[0];
      
      status = this.mapSquareStatusCode(statusCode);
      squareCode = firstError?.code || undefined;

      const category = firstError?.category;
      const code = firstError?.code;
      const detail = firstError?.detail;

      switch (category) {
        case 'INVALID_REQUEST_ERROR':
          // resource_missing, amount_too_small, invalid_card, etc.
          message = this.mapSquareErrorMessage(code, detail);
          break;
          
        case 'PAYMENT_ERROR':
          // card_declined, insufficient_funds, etc.
          message = detail || "Card payment failed";
          break;
          
        case 'INTERNAL_SERVER_ERROR':
          status = HttpStatus.SERVICE_UNAVAILABLE;
          message = "Payment service temporarily unavailable. Please try again.";
          break;
          
        case 'UNAUTHORIZED':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = "Payment configuration error";
          console.error("Square authentication error:", detail);
          break;
          
        default:
          message = detail || "Payment processing error";
      }
    }

    // 3) MikroORM validation
    else if (exception instanceof ValidationError) {
      const rawMessage = exception.message;
      const match = rawMessage.match(/Value for (\w+\.\w+) is required, 'undefined' found/);
      const field = match?.[1];
      const cleanMessage = field ? `${field} is required or undefined` : rawMessage;
      
      status = HttpStatus.BAD_REQUEST;
      message = cleanMessage;
    }

    // 4) MikroORM unique constraint
    else if (exception instanceof UniqueConstraintViolationException) {
      status = HttpStatus.CONFLICT;
      const constraint = (exception as any).constraint;

      if (constraint === "user_email_unique") {
        message = "Email already exists";
      } else if (constraint === "user_phone_number_unique") {
        message = "Phone number already exists";
      } else {
        message = constraint;
      }
    }

    // 5) PostgreSQL raw errors
    else if ((exception as any).code === "23505") {
      status = HttpStatus.CONFLICT;
      message = "Duplicate record already exists";
    } else if ((exception as any).code === "23503") {
      status = HttpStatus.BAD_REQUEST;
      message = "Invalid reference to related record";
    } else if ((exception as any).code === "23502") {
      status = HttpStatus.BAD_REQUEST;
      message = "Required database field missing";
    }

    // 6) Unknown error logging
    else {
      console.error("Unhandled exception:", exception);
    }

    // 7) Construct response
    const errorResponse: any = {
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (squareCode) {
      errorResponse.squareCode = squareCode;
    }

    if (exceptionResponse?.errorCode) {
      errorResponse.errorCode = exceptionResponse.errorCode;
    }

    response.status(status).json(errorResponse);
  }

  private mapStripeErrorMessage(error: any): string {
    const code = error.code;
    const param = (error as any).param;

    switch (code) {
      case "resource_missing":
        if (param === "payment_method") {
          return "Payment method not found. It may have expired or was never created.";
        }
        if (param === "customer") {
          return "Customer account not found. Please create one first.";
        }
        return `Requested resource not found: ${param || error.message}`;
      
      case "amount_too_small":
        return "Amount is too small. Minimum charge is 50 cents.";
      
      case "amount_too_large":
        return "Amount exceeds maximum allowed charge.";
      
      case "currency_not_supported":
        return "Selected currency is not supported.";
      
      case "incorrect_number":
        return "The card number is incorrect.";
      
      case "invalid_expiry_month":
      case "invalid_expiry_year":
        return "The card expiration date is invalid.";
      
      case "invalid_cvc":
        return "The card security code is invalid.";
      
      case "expired_card":
        return "The card has expired.";
      
      case "incorrect_cvc":
        return "The card security code is incorrect.";
      
      case "incorrect_zip":
        return "The card zip code failed validation.";
      
      case "card_declined":
        return "The card was declined.";
      
      case "missing":
        return `Required parameter missing: ${param || "unknown"}`;
      
      case "processing_error":
        return "An error occurred while processing the card.";
      
      case "issuer_not_available":
        return "The card issuer could not be reached. Please try again.";
      
      case "try_again_later":
        return "Temporary issue processing the payment. Please try again.";
      
      default:
        return error.message || "Invalid payment request";
    }
  }
}