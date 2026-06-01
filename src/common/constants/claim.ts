import { ClaimStatus } from "../enum/claims";

export const allowedTransitions: Record<string, ClaimStatus[]> = {
    [ClaimStatus.SUBMITTED]: [
      ClaimStatus.UNDER_REVIEW,
      ClaimStatus.APPROVED,
      ClaimStatus.REJECTED,
    ],
    [ClaimStatus.UNDER_REVIEW]: [
      ClaimStatus.APPROVED,
      ClaimStatus.REJECTED,
    ],
    [ClaimStatus.APPROVED]: [ClaimStatus.RESOLVED],
    [ClaimStatus.REJECTED]: [],
    [ClaimStatus.RESOLVED]: [],
  };