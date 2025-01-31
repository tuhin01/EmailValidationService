import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { RegisterDto } from '../auth/dto/register.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  async create(registerDto: RegisterDto): Promise<User> {
    const existingUser = await User.findOneBy({
      email_address: registerDto.email_address,
    });
    if (existingUser) {
      throw new BadRequestException(
        `${registerDto.email_address} already exist!`,
      );
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(registerDto.password, salt);

    const user: User = User.create({
      ...registerDto,
      password: hashedPassword,
    });
    const dbUser = await user.save();
    delete dbUser.password;
    return dbUser;
  }

  findAll() {
    return `This action returns all users`;
  }

  async findOne(email: string) {
    return await User.findOneBy({
      email_address: email,
    });
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
