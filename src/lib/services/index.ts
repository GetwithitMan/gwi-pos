/**
 * Services Layer - Barrel Export
 *
 * Service classes encapsulate API calls and business logic,
 * providing clean interfaces for components.
 */

export { PaymentService, paymentService } from './payment-service'

export type {
  PaymentRequest,
  PaymentInput,
  PaymentResponse,
  ProcessedPayment,
  VoidRequest,
  VoidResponse,
  RemoteVoidApprovalRequest,
  RemoteVoidApprovalResponse,
  GiftCardBalanceRequest,
  GiftCardBalanceResponse,
  HouseAccount,
  HouseAccountsResponse,
  ServiceResult,
} from './payment-service'

export { isSuccessResult, getErrorMessage } from './payment-service'
