// common/pipes/app-validation.pipe.ts

import { BadRequestException, Injectable, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,

      transformOptions: {
        enableImplicitConversion: true,
      },

      exceptionFactory: (errors) => {
        const fields = collectValidationFields(errors);
        return new BadRequestException({
          message: 'Validation failed',
          fields,
        });
      },
    });
  }
}

function collectValidationFields(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const error of errors) {
    const propertyPath = parentPath ? `${parentPath}.${error.property}` : error.property;
    const constraints = error.constraints ?? {};
    const firstConstraint = Object.values(constraints)[0];

    if (firstConstraint !== undefined) {
      fields[propertyPath] = firstConstraint;
    }

    if (error.children?.length) {
      Object.assign(fields, collectValidationFields(error.children, propertyPath));
    }

    if (firstConstraint === undefined && !error.children?.length) {
      fields[propertyPath] = 'Invalid value';
    }
  }

  return fields;
}
