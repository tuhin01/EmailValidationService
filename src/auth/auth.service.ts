import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(private readonly userService: UsersService) {
  }

  public async login() {
    const users = this.userService.findAll();
    console.log({ users });
  }
}
