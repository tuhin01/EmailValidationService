import { Injectable } from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

const fakeUsers = [
  {
    id: 1,
    username: 'anson@gmail.com',
    password: 'password',
  },
  {
    id: 2,
    username: 'jack',
    password: 'password123',
  },
];

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService, private userService: UsersService) {
  }

  async register(registerDto: RegisterDto) {
    return this.userService.create(registerDto);
  }

  async validateUser({ email_address, password }: AuthPayloadDto) {
    console.log(email_address);
    const findUser = fakeUsers.find((user) => user.username === email_address);
    if (!findUser) return null;
    const user = this.userService.findAll();
    console.log(user);
    if (password === findUser.password) {
      const { password, ...user } = findUser;
      return this.jwtService.sign(user);
    }
  }
}
