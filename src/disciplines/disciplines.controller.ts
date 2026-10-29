import { Body, ConflictException, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { Public, Roles } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDisciplineDto, UpdateDisciplineDto } from './disciplines.dto.js';

@Controller('disciplines')
export class DisciplinesController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  list() {
    return this.prisma.discipline.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
  }

  /** Incluye las desactivadas, para poder reactivarlas */
  @Roles('admin')
  @Get('all')
  listAll() {
    return this.prisma.discipline.findMany({ orderBy: { id: 'asc' } });
  }

  @Roles('admin')
  @Post()
  async create(@Body() dto: CreateDisciplineDto) {
    try {
      return await this.prisma.discipline.create({ data: dto });
    } catch (e) {
      throw duplicate(e) ?? e;
    }
  }

  @Roles('admin')
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDisciplineDto) {
    try {
      return await this.prisma.discipline.update({ where: { id }, data: dto });
    } catch (e) {
      throw duplicate(e) ?? e;
    }
  }
}

const duplicate = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ConflictException('Ya existe una disciplina con ese nombre o slug')
    : null;
