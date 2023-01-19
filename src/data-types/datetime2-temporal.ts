import { DataType } from '../data-type';
import WritableTrackingBuffer from '../tracking-buffer/writable-tracking-buffer';
import { TemporalBinding, TemporalTypeCheck, getDaysSinceYearOneDayOneFromTemporalZdt, getSqlServerTimeFromTemporalZdt, stringToTemporalObject, temporalBindingFromTediousDate, temporalBindingFromTemporalObject } from '../utils/temporals';

const NULL_LENGTH = Buffer.from([0x00]);

const DateTime2Temporal: DataType & { resolveScale: NonNullable<DataType['resolveScale']> } = {
  id: 0x2A,
  type: 'DATETIME2N',
  name: 'DateTime2Temporal',

  declaration: function(parameter) {
    return 'datetime2(' + (this.resolveScale(parameter)) + ')';
  },

  resolveScale: function(parameter) {
    if (parameter.scale != null) {
      return parameter.scale;
    } else if (parameter.value === null) {
      return 0;
    } else {
      return 7;
    }
  },

  generateTypeInfo(parameter, _options) {
    return Buffer.from([this.id, parameter.scale!]);
  },

  generateParameterLength(parameter, options) {
    if (parameter.value == null) {
      return NULL_LENGTH;
    }

    switch (parameter.scale!) {
      case 0:
      case 1:
      case 2:
        return Buffer.from([0x06]);

      case 3:
      case 4:
        return Buffer.from([0x07]);

      case 5:
      case 6:
      case 7:
        return Buffer.from([0x08]);

      default:
        throw new Error('invalid scale');
    }
  },

  * generateParameterData(parameter, options) {
    if (parameter.value == null) {
      return;
    }

    const temporalBinding = parameter.value;

    const scale = parameter.scale!;
    const buffer = new WritableTrackingBuffer(16);
    const zdt = temporalBinding.instant.toZonedDateTimeISO(temporalBinding.timezone);

    let nextDay = false;
    let time = getSqlServerTimeFromTemporalZdt(zdt, scale);

    if (time / Math.pow(10, scale) === 86400) {
        time = 0;
        nextDay = true;
    }

    switch (scale) {
        case 0:
        case 1:
        case 2:
            buffer.writeUInt24LE(time);
            break;

        case 3:
        case 4:
            buffer.writeUInt32LE(time);
            break;

        case 5:
        case 6:
        case 7:
            buffer.writeUInt40LE(time);
    }

    // write days
    buffer.writeUInt24LE(getDaysSinceYearOneDayOneFromTemporalZdt(zdt) + (nextDay ? 1 : 0));
    yield buffer.data;
  },

  validate: function(value): null | TemporalBinding {
    if (value == null) {
      return null;
    }
    const isDate = value instanceof Date;
    if (isDate) {
        return temporalBindingFromTediousDate(value, TemporalTypeCheck.NOTIMEZONE);
    } else {
        const dateObject = stringToTemporalObject(value, TemporalTypeCheck.NOTIMEZONE);
        if (dateObject === null) {
            throw new TypeError(`"${value}" is not a valid date format!`);
        }
        return temporalBindingFromTemporalObject(dateObject);
    }
  }
};

export default DateTime2Temporal;
module.exports = DateTime2Temporal;
