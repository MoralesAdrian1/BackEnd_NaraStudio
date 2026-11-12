import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseAdmin } from '../auth/supabase-admin.js';
import { StudentPhotos } from '../common/student-photos.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Borrar la cuenta de una alumna y sus datos personales (derecho de cancelación, LFPDPPP).
 * Los pagos y las reservas se conservan por obligación fiscal, pero quedan anónimos: ya no se
 * puede saber de quién eran. Lo puede pedir la alumna desde su perfil o hacerlo la admin.
 */
@Injectable()
export class AccountDeletion {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdmin,
    private readonly photos: StudentPhotos,
  ) {}

  async deleteStudent(studentId: number) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { profile: { select: { id: true, role: true } } },
    });
    if (!student || student.deletedAt) throw new NotFoundException('Esa alumna no existe');
    if (student.profile && student.profile.role !== 'student') {
      throw new BadRequestException('Esta cuenta es de una coach: primero quítale el rol de coach');
    }
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Libera sus lugares en clases que no han pasado y cierra lo que tenía pendiente
      await tx.booking.updateMany({
        where: { studentId, status: 'booked', session: { startsAt: { gt: now } } },
        data: { status: 'cancelled_by_student', cancelledAt: now },
      });
      await tx.membership.updateMany({
        where: { studentId, status: { in: ['pending_payment', 'awaiting_card', 'active'] } },
        data: { status: 'cancelled', autoRenew: false },
      });
      await tx.studentHealth.deleteMany({ where: { studentId } });
      await tx.studentStreak.deleteMany({ where: { studentId } });
      await tx.leaderboardEntry.deleteMany({ where: { studentId } });
      await tx.legalAcceptance.deleteMany({ where: { studentId } });
      await tx.student.update({
        where: { id: studentId },
        data: {
          fullName: 'Alumna eliminada',
          publicName: null,
          email: null,
          phone: null,
          birthDate: null,
          photoPath: null,
          stripeCustomerId: null,
          guardianName: null,
          guardianPhone: null,
          guardianEmail: null,
          guardianConsentAt: null,
          isActive: false,
          deletedAt: now,
        },
      });
    });

    if (student.profileId) {
      await this.photos.removeFolder(student.profileId).catch(() => undefined);
      // Borra la cuenta de acceso; el perfil se borra en cascada y la alumna queda sin cuenta
      await this.admin.removeUser(student.profileId);
    }
    return { ok: true };
  }
}
