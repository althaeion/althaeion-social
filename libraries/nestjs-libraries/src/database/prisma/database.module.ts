import { Global, Module } from '@nestjs/common';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { AgenciesService } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.service';
import { AgenciesRepository } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.repository';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.repository';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.service';
import { AutomationEngine } from '@gitroom/nestjs-libraries/automation/automation.engine';
import { AutomationNodeRunner } from '@gitroom/nestjs-libraries/automation/automation.node.runner';
import { AutomationConfigValidator } from '@gitroom/nestjs-libraries/automation/automation.config.validator';
import { ExpressionResolver } from '@gitroom/nestjs-libraries/automation/expression.resolver';
import { BrandRepository } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.repository';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';
import { BrandAnalyzer } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.analyzer';
import { AiUsageRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.repository';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';
import { AdsRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsGenerator } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.generator';
import { AutopilotRepository } from '@gitroom/nestjs-libraries/database/prisma/autopilot/autopilot.repository';
import { AutopilotService } from '@gitroom/nestjs-libraries/database/prisma/autopilot/autopilot.service';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.preference.service';
import { ConnectionVerifier } from '@gitroom/nestjs-libraries/database/prisma/integrations/connection.verifier';
import { SafeHttpFetcher } from '@gitroom/nestjs-libraries/services/safe.http.fetcher';
import { LinkCardService } from '@gitroom/nestjs-libraries/services/link.card.service';
import { StockMediaService } from '@gitroom/nestjs-libraries/services/stock.media.service';
import { ContentEditorService } from '@gitroom/nestjs-libraries/openai/content.editor.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { ThirdPartyRepository } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { FalService } from '@gitroom/nestjs-libraries/openai/fal.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ErrorsRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.repository';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    NotificationService,
    NotificationsRepository,
    WebhooksRepository,
    WebhooksService,
    IntegrationService,
    IntegrationRepository,
    PostsService,
    PostsRepository,
    StripeService,
    SignatureRepository,
    AutomationRepository,
    AutomationService,
    AutomationEngine,
    AutomationNodeRunner,
    AutomationConfigValidator,
    ExpressionResolver,
    BrandRepository,
    BrandService,
    BrandAnalyzer,
    AiUsageRepository,
    AiUsageService,
    AdsRepository,
    AdsService,
    AdsGenerator,
    AutopilotRepository,
    AutopilotService,
    ConnectionVerifier,
    NotificationPreferenceService,
    SafeHttpFetcher,
    LinkCardService,
    StockMediaService,
    ContentEditorService,
    AutopostRepository,
    AutopostService,
    SignatureService,
    MediaService,
    MediaRepository,
    AgenciesService,
    AgenciesRepository,
    IntegrationManager,
    RefreshIntegrationService,
    ExtractContentService,
    OpenaiService,
    FalService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    ThirdPartyRepository,
    ThirdPartyService,
    OAuthRepository,
    OAuthService,
    VideoManager,
    AnnouncementsRepository,
    AnnouncementsService,
    ErrorsRepository,
    ErrorsService,
    AdminStatsRepository,
    AdminStatsService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
