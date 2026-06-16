import { IsEnum, IsNumber } from "class-validator";
import { Carrier } from "./create-carrier-shipment.dto";

export class ShipmentStatusDTO {
  @IsNumber()
  shipmentId!: number;

  @IsEnum(Carrier)
  carrier!: Carrier;
}