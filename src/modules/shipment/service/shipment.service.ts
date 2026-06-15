import { EntityManager } from "@mikro-orm/postgresql";
import { BadRequestException, Injectable  } from "@nestjs/common";
import { SessionData } from "express-session";
import { CreateShipmentDTO } from "../dto/create-shipment.dto";
import { Shipment } from "src/entities/shipment.entity";
import { BillingReference } from "src/entities/BillingReference.entity";
import { QuoteType } from "src/common/enum/quote-type.enum";
import { StandardQuoteFactory } from "src/factory/standard-quote.factory";
import { UpdateShipmentDTO } from "../dto/update-shipment.dto";
import { Quote } from "src/entities/quote.entity";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotificationType } from "src/common/enum/notification-type.enum";
import { QuoteStatus } from "src/common/enum/quote-status";
import { Company } from "src/entities/company.entity";
import { User } from "src/entities/user.entity";

@Injectable()
export class ShipmentService {
  constructor(
    private readonly em: EntityManager, 
    private readonly eventEmitter: EventEmitter2
  ) {}

  private async buildQuote(dto: CreateShipmentDTO, session: SessionData) {
    if(dto?.quote?.quoteType !== QuoteType.STANDARD){
      throw new BadRequestException("Shipment supports only standard quote shipment types");
    }

    const quoteFactory = new StandardQuoteFactory();
    let finalData = {...dto, ...dto.quote};
    
    const quote = quoteFactory.create({ shipmentType: dto.shipmentType, data: finalData, em: this.em, session });
    
    // Sync validation - throws BadRequestException if invalid
    await quote.validate();
    
    // Async build - returns populated Quote entity
    return await quote.build();
  }

  private async updateQuote(
    quote: Quote,
    dto: any,
    session: SessionData
  ): Promise<Quote> {
    if (!dto?.quote?.quoteType) {
      throw new BadRequestException("quoteType is required in quote");
    }

    if (dto.quote.quoteType !== QuoteType.STANDARD) {
      throw new BadRequestException("Shipment supports only standard quote shipment types");
    }

   
    const dataWithId = {
        ...dto,
        quote: {
            ...dto.quote,
            id: quote.id  // ← Add the missing ID
        }
    };

    const quoteFactory = new StandardQuoteFactory();
    const handler = quoteFactory.update({
        shipmentType: dto.shipmentType,
        data: dataWithId,  // ← Use the modified data
        em: this.em,
        session
    });

    await handler.init();      // Now this.existingQuote will be populated
    await handler.validate();
    await handler.update();

    return quote;
  }

  async create(createShipmentDto: CreateShipmentDTO, session: SessionData) {
        //1) Validate and build the quote based on shipment type
        let quote;

        if(!createShipmentDto?.quote?.id) {
          quote = await this.buildQuote(createShipmentDto, session);
        } else {
          const quoteDoc: any = await this.em.findOne(Quote, { id: createShipmentDto.quote.id }, { populate: ["addresses", "addresses.addressBookEntry", "addresses.address", "addresses.addressBookEntry.address", "lineItems", "lineItems.units" ]})
          
          if(quoteDoc.quoteType !== QuoteType.STANDARD) {
            throw new BadRequestException("Shipment supports only standard quote shipment types");
          }

          quote = await this.updateQuote(quoteDoc, createShipmentDto, session);
        }  

        //2) Create shipment with the built quote
        const shipment = new Shipment();
        shipment.shipDate = new Date(createShipmentDto.shipDate);
        shipment.quote = quote;
        shipment.tailgateRequiredInToAddress = createShipmentDto.tailgateRequiredInToAddress ?? false;
        shipment.tailgateRequiredInFromAddress = createShipmentDto.tailgateRequiredInFromAddress ?? false;
        shipment.company = this.em.getReference(Company, session.companyId as number);
        shipment.bookedBy = this.em.getReference(User, session.userId as number);

        //3) Build and attach billing references
        if (createShipmentDto.billingReferences && createShipmentDto.billingReferences?.length > 0) {
            const billingReferences = createShipmentDto.billingReferences.map(code => {
                const ref = new BillingReference();
                ref.code = code;
                ref.shipment = shipment; // Set inverse side
                return ref;
            });

            shipment.billingReferences.add([...billingReferences]);
        }

        //4) Persist everything in one transaction
        quote.status = QuoteStatus.CONVERTED_TO_SHIPMENT;
        this.em.persist(quote);
        this.em.persist(shipment);

        await this.em.flush()

        // 5) Send out notification to all memebers of company
        this.eventEmitter.emit(NotificationType.QUOTE_FOR_SHIPMENT, {
          entity: shipment,
          actorId: session.userId,
          companyId: session.companyId,
          metadata: {
            shipmentId: shipment.id,
            quoteId: quote.id
          }
        })

        //6) Return populated response
        return {
          message: "Quote for shipment created successfully",
          quote
        }
    }

  async update(
    updateShipmentDto: UpdateShipmentDTO,
    shipmentId: number,
    session: SessionData
  ): Promise<any> {
      //1) Get the shipment
      const shipment = await this.em.findOne(Shipment, shipmentId, {
        populate: [
          'quote',
          'quote.addresses',
          'quote.addresses.addressBookEntry',
          'quote.addresses.addressBookEntry.address'
        ]
      });

      //2) Throw exception for invalid shipment id
      if (!shipment) {
        throw new BadRequestException(
          "Invalid shipmentId or you don't have the required permissions"
        );
      }

      //3) Call in update quote
      await this.updateQuote(shipment.quote, updateShipmentDto, session);

      //4) Persist all changes
      await this.em.flush();

      //5) Ensure fresh state for response
      await this.em.refresh(shipment, {
        populate: [
          'quote',
          'quote.addresses',
          'quote.addresses.addressBookEntry',
          'quote.addresses.addressBookEntry.address'
        ]
      });

      //6) Send out notification to all members of the company
      this.eventEmitter.emit(NotificationType.SHIPMENT_UPDATED, {
          entity: shipment,
          actorId: session.userId,
          companyId: session.companyId,
          metadata: {
            shipmentId: shipment.id,
            quoteId: shipment.quote.id
          }
        })

      //7) Return success response
      return {
        message: "Shipment updated successfully",
        quote: shipment.quote
      };
    }
}