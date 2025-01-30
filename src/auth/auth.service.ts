import { Injectable } from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService, private userService: UsersService) {
  }

  async register(registerDto: RegisterDto) {
    return this.userService.create(registerDto);
  }

  async validateUser(authPayloadDto: AuthPayloadDto) {
    const user: User = await this.userService.findOne(authPayloadDto.email_address);
    if (!user) {
      return null;
    }
    const matchedPassword = await bcrypt.compare(authPayloadDto.password, user.password);
    if (matchedPassword) {
      delete user.password;
      return this.jwtService.sign({ ...user });
    }
    return null;
  }
}
