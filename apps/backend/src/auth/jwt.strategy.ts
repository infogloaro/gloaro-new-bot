import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.service';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** NULL for SUPER_ADMIN, who is not pinned to one tenant. */
  tenantId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<JwtConfig>('jwt')!.secret,
    });
  }

  /** Re-checks the user on every request so a deactivated account loses access immediately. */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: { select: { isActive: true } } },
    });
    if (!user?.isActive) throw new UnauthorizedException('Account is no longer active');
    // A suspended client must not keep working through an already-issued token.
    if (user.tenant && !user.tenant.isActive) {
      throw new UnauthorizedException('This workspace has been suspended');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    };
  }
}
