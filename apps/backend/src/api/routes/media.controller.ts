import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService
  ) {}

  @Delete('/:id')
  deleteMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._mediaService.deleteMedia(org.id, id);
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    console.log('hello');
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/generate-image')
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      return false;
    }

    return {
      output:
        'data:image/png;base64,' +
        (await this._mediaService.generateImage(prompt, org, isPicturePrompt)),
    };
  }

  @Post('/generate-image-with-prompt')
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string
  ) {
    const image = await this.generateImage(org, req, prompt, true);
    if (!image) {
      return false;
    }

    const file = await this.storage.uploadSimple(image.output);

    return this._mediaService.saveFile(org.id, file.split('/').pop(), file);
  }

  @Post('/upload-server')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    const originalName = file?.originalname || '';
    const uploadedFile = await this.storage.uploadFile(file);
    return this._mediaService.saveFile(
      org.id,
      uploadedFile.originalname,
      uploadedFile.path,
      originalName
    );
  }

  @Post('/save-media')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string
  ) {
    if (!name) {
      return false;
    }
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    const originalName = file.originalname;
    const getFile = await this.storage.uploadFile(file);

    if (preventSave === 'true') {
      const { path } = getFile;
      return { path };
    }

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName
    );
  }

  // Upload en MORCEAUX — PORT FIDÈLE du vrai TryPost
  // (App\Services\Media\ChunkedAssetReceiver::receiveViaLocalAssemble +
  //  App\Http\Controllers\App\AssetController::storeChunked). Contrat IDENTIQUE :
  //  query params file_name/range_start/range_end/total_size/upload_id, et le
  //  chunk = le CORPS BRUT de la requête ($request->getContent() côté Laravel).
  //  identifier = md5(userId + fileName + totalSize + uploadId) ; range_start===0
  //  écrit, sinon append ; fini quand (range_end+1) >= total_size.
  //  Déclaré AVANT `/:endpoint` (route catch-all).
  @Post('/upload-chunked')
  async uploadChunked(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Query('file_name') fileName: string,
    @Query('range_start') rangeStartStr: string,
    @Query('range_end') rangeEndStr: string,
    @Query('total_size') totalSizeStr: string,
    @Query('upload_id') uploadId: string
  ) {
    const rangeStart = parseInt(rangeStartStr || '0', 10) || 0;
    const rangeEnd = parseInt(rangeEndStr || '0', 10) || 0;
    const totalSize = parseInt(totalSizeStr || '0', 10) || 0;

    // chunk = corps brut de la requête (comme $request->getContent())
    const chunk: Buffer = await new Promise((resolve, reject) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => resolve(Buffer.concat(parts)));
      req.on('error', reject);
    });

    // identifier = md5("{userId}{fileName}{totalSize}{uploadId}")  (TryPost)
    const identifier = crypto
      .createHash('md5')
      .update(`${org.id}${fileName}${totalSize}${uploadId}`)
      .digest('hex');

    const dir = path.join(os.tmpdir(), 'postiz-chunks');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempFile = path.join(dir, identifier);

    // range_start === 0 -> écrit (tronque) ; sinon append   (TryPost)
    if (rangeStart === 0) {
      fs.writeFileSync(tempFile, chunk);
    } else {
      fs.appendFileSync(tempFile, chunk);
    }

    // encore en cours ? progress = (range_end+1)/total_size * 100   (TryPost)
    if (rangeEnd + 1 < totalSize) {
      return {
        done: false,
        progress: Math.round(((rangeEnd + 1) / totalSize) * 100),
      };
    }

    // dernier morceau : assembler -> uploader via le storage Postiz -> saveFile
    // (équivalent de $workspace->addMediaFromPath(tempFile, fileName, 'assets'))
    const buffer = fs.readFileSync(tempFile);
    const assembled = {
      fieldname: 'file',
      originalname: fileName || identifier,
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: buffer.length,
      buffer,
      destination: '',
      filename: '',
      path: '',
      stream: undefined as any,
    } as Express.Multer.File;
    const uploaded = await this.storage.uploadFile(assembled);
    try {
      fs.unlinkSync(tempFile);
    } catch {
      /* noop */
    }
    const media = await this._mediaService.saveFile(
      org.id,
      uploaded.originalname,
      uploaded.path,
      fileName || uploaded.originalname
    );
    return { done: true, media };
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    const upload = await handleR2Upload(endpoint, req, res);
    if (endpoint !== 'complete-multipart-upload') {
      return upload;
    }

    // @ts-ignore
    const name = upload.Location.split('/').pop();
    const originalName = req.body?.file?.name;

    const saveFile = await this._mediaService.saveFile(
      org.id,
      name,
      // @ts-ignore
      upload.Location,
      originalName || undefined
    );

    res.status(200).json({ ...upload, saved: saveFile });
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number,
    @Query('search') search?: string
  ) {
    return this._mediaService.getMedia(org.id, page, search);
  }

  @Get('/video-options')
  getVideos() {
    return this._mediaService.getVideoOptions();
  }

  @Post('/video/function')
  videoFunction(
    @Body() body: VideoFunctionDto
  ) {
    return this._mediaService.videoFunction(body.identifier, body.functionName, body.params);
  }

  @Get('/generate-video/:type/allowed')
  generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    return this._mediaService.generateVideoAllowed(org, type);
  }
}
