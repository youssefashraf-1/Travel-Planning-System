export enum BookingStatus {
  PENDING_PAYMENT = 'pending_payment',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export function wasConfirmed(this: { status: BookingStatus }): boolean {
  return (
    this.status === BookingStatus.CONFIRMED ||
    this.status === BookingStatus.COMPLETED ||
    this.status === BookingStatus.CANCELLED
  );
}
