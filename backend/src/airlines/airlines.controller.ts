import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProviderType } from '../auth/access';
import { ManagesProvider } from '../auth/decorators/manages-provider.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProviderOwnerGuard } from '../auth/guards/provider-owner.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { AirlinesService } from './airlines.service';
import {
  AirlineResponseDto,
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiOperation({ summary: 'Create an airline (FLT-01)' })
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  create(@Body() dto: CreateAirlineDto) {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View an airline (FLT-01)' })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiNotFoundResponse()
  findById(@Param('id') id: string) {
    return this.airlines.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, ProviderOwnerGuard)
  @ManagesProvider(ProviderType.AIRLINE)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiOperation({ summary: 'Edit your airline profile (FLT-01)' })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  update(@Param('id') id: string, @Body() dto: UpdateAirlineDto) {
    return this.airlines.update(id, dto);
  }

  @Put(':id/baggage-policy')
  @UseGuards(JwtAuthGuard, ProviderOwnerGuard)
  @ManagesProvider(ProviderType.AIRLINE)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiOperation({ summary: 'Set extra baggage pricing and limits (FLT-08)' })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  baggage(@Param('id') id: string, @Body() dto: BaggagePolicyDto) {
    return this.airlines.setBaggagePolicy(id, dto);
  }

  @Put(':id/cancellation-policy')
  @UseGuards(JwtAuthGuard, ProviderOwnerGuard)
  @ManagesProvider(ProviderType.AIRLINE)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiOperation({ summary: 'Set cancellation refund tiers (FLT-09)' })
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  cancellation(@Param('id') id: string, @Body() dto: CancellationPolicyDto) {
    return this.airlines.setCancellationPolicy(id, dto);
  }
}
