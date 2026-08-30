import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { JwtConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Carried for convenience only - `JwtStrategy` re-reads it from the database. */
  tenantId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Compare against a dummy hash when the user does not exist so that the
    // response time does not reveal which emails are registered.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    if (!user.isActive) throw new UnauthorizedException('This account has been deactivated');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { user: this.sanitise(user), ...(await this.issueTokens(user)) };
  }

  async refresh(refreshToken: string) {
    const cfg = this.config.get<JwtConfig>('jwt')!;
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: cfg.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.isActive) throw new UnauthorizedException('Account is no longer active');

    return { user: this.sanitise(user), ...(await this.issueTokens(user)) };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });
    return { changed: true };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.sanitise(user);
  }

  private async issueTokens(user: User) {
    const cfg = this.config.get<JwtConfig>('jwt')!;
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { secret: cfg.secret, expiresIn: cfg.expiresIn }),
      this.jwt.signAsync(payload, { secret: cfg.refreshSecret, expiresIn: cfg.refreshExpiresIn }),
    ]);

    return { accessToken, refreshToken };
  }

  private sanitise(user: User) {
    const { passwordHash, ...rest } = user;
    void passwordHash;
    return rest;
  }
}
