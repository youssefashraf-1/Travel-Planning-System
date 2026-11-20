import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { UserDocument } from '../../src/users/schemas/user.schema';

/**
 * Test-only protected route at GET /api/e2e-probe, used by e2e tests to
 * check the login cookie, sessions and JwtAuthGuard together.
 */
@Controller('e2e-probe')
export class E2eProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  whoAmI(@CurrentUser() user: UserDocument) {
    return { id: user._id.toString(), email: user.email };
  }
}
