import { DataType } from '../data-type';
import WritableTrackingBuffer from '../tracking-buffer/writable-tracking-buffer';
import { TemporalBinding, TemporalTypeCheck, getDaysSinceYearOneDayOneFromTemporalZdt, getSqlServerTimeFromTemporalZdt, nanoSecondsOffsetToOffset, stringToTemporalObject, temporalBindingFromTediousDate, temporalBindingFromTemporalObject } from '../utils/temporals';

const NULL_LENGTH = Buffer.from([0x00]);

const DateTimeOffsetTemporal: DataType & { resolveScale: NonNullable<DataType['resolveScale']> } = {
  id: 0x2B,
  type: 'DATETIMEOFFSETN',
  name: 'DateTimeOffsetTemporal',
  declaration: function(parameter) {
    return 'datetimeoffset(' + (this.resolveScale(parameter)) + ')';
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

  generateTypeInfo(parameter) {
    return Buffer.from([this.id, parameter.scale!]);
  },

  generateParameterLength(parameter, options) {
    if (parameter.value == null) {
      return NULL_LENGTH;
    }

    switch (parameter.scale) {
      case 0:
      case 1:
      case 2:
        return Buffer.from([0x08]);

      case 3:
      case 4:
        return Buffer.from([0x09]);

      case 5:
      case 6:
      case 7:
        return Buffer.from([0x0A]);

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

    const utcZdt = temporalBinding.instant.toZonedDateTimeISO('+00:00');

    let nextDay = false;
    let time = getSqlServerTimeFromTemporalZdt(utcZdt, scale);

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
    buffer.writeUInt24LE(getDaysSinceYearOneDayOneFromTemporalZdt(utcZdt) + (nextDay ? 1 : 0));
    // write offset minutes
    buffer.writeInt16LE(
        nanoSecondsOffsetToOffset(
            temporalBinding.instant.toZonedDateTimeISO(temporalBinding.timezone).offsetNanoseconds
        )
    );
    yield buffer.data;
  },
  validate: function(value): null | TemporalBinding {
    if (value == null) {
      return null;
    }
    const isDate = value instanceof Date;
    if (isDate) {
        return temporalBindingFromTediousDate(value, TemporalTypeCheck.FULL);
    } else {
        const dateObject = stringToTemporalObject(value, TemporalTypeCheck.FULL);
        if (dateObject === null) {
            throw new TypeError(`"${value}" is not a valid date format!`);
        }
        return temporalBindingFromTemporalObject(dateObject);
    }
  }
};

export default DateTimeOffsetTemporal;
module.exports = DateTimeOffsetTemporal;
