import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  AcceptPoliciesDto,
  BookingPoliciesDto,
  BookingType,
  CreatePaymentDto,
  PaymentDto,
  RefundDto,
  RetryPaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

const Traveler = () => UseGuards(JwtAuthGuard, RolesGuard);

@ApiTags('Payments')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({ description: 'Only travelers pay for bookings.' })
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  @Get('bookings/:type/:id/policies')
  @Traveler()
  @Roles(UserRole.TRAVELER)
  @ApiParam({ name: 'type', enum: BookingType })
  @ApiParam({ name: 'id', description: 'Your booking or reservation id.' })
  @ApiOperation({
    summary: 'Policies to accept before paying (PAY-02)',
    description:
      'Airline: cancellation tiers and free and extra baggage per flight. ' +
      'Hotel: cancellation tiers and check-in and check-out times. These ' +
      'are the terms stored with the booking.',
  })
  @ApiOkResponse({ type: BookingPoliciesDto })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  policies(
    @CurrentUser() user: UserDocument,
    @Param('type', new ParseEnumPipe(BookingType)) type: BookingType,
    @Param('id') id: string,
  ): Promise<BookingPoliciesDto> {
    return this.payments.policies(user, type, id);
  }

  @Post('bookings/:type/:id/accept-policies')
  @HttpCode(HttpStatus.OK)
  @Traveler()
  @Roles(UserRole.TRAVELER)
  @ApiParam({ name: 'type', enum: BookingType })
  @ApiParam({ name: 'id', description: 'Your booking or reservation id.' })
  @ApiOperation({
    summary: 'Accept the policies (PAY-02)',
    description:
      'The acceptance checkbox. Stores the time of acceptance. Payment is ' +
      'refused until this is done.',
  })
  @ApiOkResponse({ type: BookingPoliciesDto })
  @ApiBadRequestResponse({ description: 'accept is not true.' })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  @ApiConflictResponse({
    description: 'Not waiting for payment, or the hold expired.',
  })
  acceptPolicies(
    @CurrentUser() user: UserDocument,
    @Param('type', new ParseEnumPipe(BookingType)) type: BookingType,
    @Param('id') id: string,
    @Body() _dto: AcceptPoliciesDto,
  ): Promise<BookingPoliciesDto> {
    return this.payments.acceptPolicies(user, type, id);
  }

  @Post('payments')
  @Traveler()
  @Roles(UserRole.TRAVELER)
  @ApiOperation({
    summary: 'Pay for a booking with Stripe (PAY-01)',
    description:
      'Creates a Stripe PaymentIntent for the booking total. The frontend ' +
      'confirms it with Stripe Elements and clientSecret, so card details ' +
      'never reach this server. The booking is confirmed only when Stripe ' +
      'reports success (webhook, or GET /api/payments/:id). In test mode, ' +
      'send testPaymentMethod (pm_card_visa) to pay directly from Swagger.',
  })
  @ApiCreatedResponse({ type: PaymentDto })
  @ApiBadRequestResponse({ description: 'Invalid fields or test token.' })
  @ApiResponse({
    status: HttpStatus.PAYMENT_REQUIRED,
    description: 'The card was declined; retry with paymentId.',
  })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  @ApiConflictResponse({
    description:
      'Not waiting for payment, hold expired, policies not accepted, or a payment is already in progress.',
  })
  create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentDto> {
    return this.payments.create(user, dto);
  }

  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.payments.handleWebhook(request.rawBody, signature);
  }

  @Post('payments/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Traveler()
  @Roles(UserRole.TRAVELER)
  @ApiParam({ name: 'id', description: 'The payment id.' })
  @ApiOperation({
    summary: 'Retry a failed payment (PAY-01)',
    description:
      'Allowed until the hold expires. Returns a fresh clientSecret; in ' +
      'test mode testPaymentMethod pays directly.',
  })
  @ApiOkResponse({ type: PaymentDto })
  @ApiResponse({
    status: HttpStatus.PAYMENT_REQUIRED,
    description: 'Declined again.',
  })
  @ApiNotFoundResponse({ description: 'Not found, or not your payment.' })
  @ApiConflictResponse({
    description: 'Already succeeded, cancelled, or the hold expired.',
  })
  retry(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: RetryPaymentDto,
  ): Promise<PaymentDto> {
    return this.payments.retry(user, id, dto);
  }

  @Get('payments/:id')
  @Traveler()
  @Roles(UserRole.TRAVELER)
  @ApiParam({ name: 'id', description: 'The payment id.' })
  @ApiOperation({
    summary: 'A payment and its booking (PAY-01)',
    description:
      'Checks the latest status with Stripe. A succeeded payment confirms ' +
      'the booking if the webhook has not done so yet.',
  })
  @ApiOkResponse({ type: PaymentDto })
  @ApiNotFoundResponse({ description: 'Not found, or not your payment.' })
  findOne(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<PaymentDto> {
    return this.payments.findOwn(user, id);
  }

  @Get('refunds/:id')
  @Traveler()
  @Roles(UserRole.TRAVELER)
  @ApiParam({ name: 'id', description: 'The refund id.' })
  @ApiOperation({
    summary: 'A refund and its status (PAY-03)',
    description: 'Pending, Refunded or Failed, checked with Stripe.',
  })
  @ApiOkResponse({ type: RefundDto })
  @ApiNotFoundResponse({ description: 'Not found, or not your refund.' })
  refund(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<RefundDto> {
    return this.refunds.findOwn(user, id);
  }
}
