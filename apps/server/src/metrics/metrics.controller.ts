import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyReply } from "fastify";
import { register } from "prom-client";

@ApiTags("metrics")
@Controller()
export class MetricsController {
  @Get("metrics")
  @ApiOperation({ summary: "Get Prometheus metrics" })
  async getMetrics(@Res() res: FastifyReply): Promise<void> {
    res.header("Content-Type", register.contentType);
    res.send(await register.metrics());
  }

  @Get("health")
  @ApiOperation({ summary: "Get service health status" })
  async getHealth() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }
}
