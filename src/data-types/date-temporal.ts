import { DataType } from '../data-type';
import { TemporalBinding, TemporalTypeCheck, getDaysSinceYearOneDayOneFromTemporalZdt, stringToTemporalObject, temporalBindingFromTediousDate, temporalBindingFromTemporalObject } from '../utils/temporals';

const NULL_LENGTH = Buffer.from([0x00]);
const DATA_LENGTH = Buffer.from([0x03]);

const DateTemporal: DataType = {
  id: 0x28,
  type: 'DATEN',
  name: 'DateTemporal',

  declaration: function() {
    return 'date';
  },

  generateTypeInfo: function() {
    return Buffer.from([this.id]);
  },

  generateParameterLength(parameter, options) {
    if (parameter.value == null) {
      return NULL_LENGTH;
    }

    return DATA_LENGTH;
  },

  * generateParameterData(parameter, options) {
    if (parameter.value == null) {
        return;
    }

    const temporalBinding = parameter.value;
    const buffer = Buffer.alloc(3);
    const zdt = temporalBinding.instant.toZonedDateTimeISO('+00:00');

    // write days
    buffer.writeUIntLE(getDaysSinceYearOneDayOneFromTemporalZdt(zdt), 0, 3);
    yield buffer;
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

export default DateTemporal;
module.exports = DateTemporal;
