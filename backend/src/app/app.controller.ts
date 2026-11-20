import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Check the API is running',
    description: 'Public. Returns a short greeting when the server is up.',
  })
  @ApiOkResponse({ description: 'The server is running.' })
  getHello(): string {
    return this.appService.getHello();
  }
}
