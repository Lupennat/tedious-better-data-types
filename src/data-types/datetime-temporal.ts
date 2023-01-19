import { DataType } from '../data-type';
import { TemporalBinding, TemporalTypeCheck, getDaysSince1900DayOneFromTemporalZdt, getSqlServerThreeHundredthsOfSecondFromTemporalZdt, stringToTemporalObject, temporalBindingFromTediousDate, temporalBindingFromTemporalObject } from '../utils/temporals';
import DateTimeN from './datetimen';

const NULL_LENGTH = Buffer.from([0x00]);
const DATA_LENGTH = Buffer.from([0x08]);

const DateTimeTemporal: DataType = {
  id: 0x3D,
  type: 'DATETIME',
  name: 'DateTimeTemporal',

  declaration: function() {
    return 'datetime';
  },

  generateTypeInfo() {
    return Buffer.from([DateTimeN.id, 0x08]);
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
    const buffer = Buffer.alloc(8);
    const zdt = temporalBinding.instant.toZonedDateTimeISO(temporalBinding.timezone);

    let nextDay = false;
    let threeHundredthsOfSecond = getSqlServerThreeHundredthsOfSecondFromTemporalZdt(zdt);

    if (threeHundredthsOfSecond === 25920000) {
        threeHundredthsOfSecond = 0;
        nextDay = true;
    }

    // write days
    buffer.writeInt32LE(getDaysSince1900DayOneFromTemporalZdt(zdt) + (nextDay ? 1 : 0), 0);
    // write three hundredths of second
    buffer.writeUInt32LE(threeHundredthsOfSecond, 4);
    yield buffer;
  },

  validate: function(value): null | TemporalBinding {
    if (value == null) {
      return null;
    }
    const isDate = value instanceof Date;
    if (isDate) {
        return temporalBindingFromTediousDate(value, TemporalTypeCheck.ERROR);
    } else {
        const dateObject = stringToTemporalObject(value, TemporalTypeCheck.ERROR);
        if (dateObject === null) {
            throw new TypeError(`"${value}" is not a valid date format!`);
        }
        return temporalBindingFromTemporalObject(dateObject);
    }
  }
};

export default DateTimeTemporal;
module.exports = DateTimeTemporal;
