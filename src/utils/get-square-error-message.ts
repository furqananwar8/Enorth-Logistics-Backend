// ── Helper: extract clean message from Square SDK error ─────────
export const getSquareErrorMessage = (error:  { message: string; code?: string, errors?: any, result?: any }  ) => {
  // Square SDK v35+ puts structured errors in error.result.errors
  const squareErrors = error?.result?.errors || error?.errors;

  if (Array.isArray(squareErrors) && squareErrors.length > 0) {
    const first = squareErrors[0];
    const code = first.code || first.category;
    const detail = first.detail || first.message;

    // Map known codes to friendly messages
    const friendlyMessages: Record<string, string> = {
      VALUE_TOO_HIGH: 'The amount exceeds the maximum allowed for a single charge.',
      VALUE_TOO_LOW: 'The amount is below the minimum allowed for a single charge.',
      CARD_EXPIRED: 'The card has expired. Please use a different card.',
      INVALID_EXPIRATION: 'The card expiration date is invalid.',
      VERIFY_CVV_FAILURE: 'CVV verification failed. Please check and try again.',
      VERIFY_AVS_FAILURE: 'Address verification failed. Please check your billing address.',
      CARD_DECLINED: 'The card was declined. Please use a different card or contact your bank.',
      INSUFFICIENT_FUNDS: 'Insufficient funds. Please use a different card.',
      INVALID_CARD: 'The card details are invalid. Please check and try again.',
      INVALID_EXPIRATION_DATE: 'The expiration date is invalid.',
      UNSUPPORTED_CARD_BRAND: 'This card type is not supported.',
      UNSUPPORTED_CARD_TYPE: 'This card type is not supported.',
      NOT_FOUND: 'The requested resource was not found.',
      UNAUTHORIZED: 'Unauthorized. Please check your payment configuration.',
      GENERIC_DECLINE: 'Payment was declined. Please try again or use another card.',
    };

    return {
      message: friendlyMessages[code] || detail || 'Payment could not be processed. Please try again.',
      code,
    };
  }

  // Fallback for non-Square errors
  return {
    message: error?.message || 'An unexpected error occurred. Please try again.',
  };
}