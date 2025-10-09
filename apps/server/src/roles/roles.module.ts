import { Module } from "@nestjs/common";
import { RolesService } from "./roles.service";
import { RolesController } from "src/roles/roles.controller";

@Module({
  imports: [],
  providers: [RolesService],
  controllers: [RolesController],
  exports: [RolesService],
})
export class RolesModule {}
