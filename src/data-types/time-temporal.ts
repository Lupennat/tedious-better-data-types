import { DataType } from '../data-type';
import WritableTrackingBuffer from '../tracking-buffer/writable-tracking-buffer';
import { TemporalBinding, TemporalTypeCheck, getSqlServerTimeFromTemporalZdt, stringToTemporalObject, temporalBindingFromTediousDate, temporalBindingFromTemporalObject } from '../utils/temporals';

const NULL_LENGTH = Buffer.from([0x00]);

const TimeTemporal: DataType = {
  id: 0x29,
  type: 'TIMEN',
  name: 'TimeTemporal',

  declaration: function(parameter) {
    return 'time(' + (this.resolveScale!(parameter)) + ')';
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
        return Buffer.from([0x03]);
      case 3:
      case 4:
        return Buffer.from([0x04]);
      case 5:
      case 6:
      case 7:
        return Buffer.from([0x05]);
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

    let time = getSqlServerTimeFromTemporalZdt(zdt, scale);

    // time must not round to next day
    if (time / Math.pow(10, scale) === 86400) {
        time = time - 1;
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


export default TimeTemporal;
module.exports = TimeTemporal;
