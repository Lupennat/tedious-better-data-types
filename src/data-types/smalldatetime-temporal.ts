import { DataType } from '../data-type';
import { TemporalBinding, TemporalTypeCheck, getDaysSince1900DayOneFromTemporalZdt, getSqlServerMinutesFromTemporalZdt, stringToTemporalObject, temporalBindingFromTediousDate, temporalBindingFromTemporalObject } from '../utils/temporals';
import DateTimeN from './datetimen';

const DATA_LENGTH = Buffer.from([0x04]);
const NULL_LENGTH = Buffer.from([0x00]);

const SmallDateTimeTemporal: DataType = {
  id: 0x3A,
  type: 'DATETIM4',
  name: 'SmallDateTimeTemporal',

  declaration: function() {
    return 'smalldatetime';
  },

  generateTypeInfo() {
    return Buffer.from([DateTimeN.id, 0x04]);
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
    const buffer = Buffer.alloc(4);
    const zdt = temporalBinding.instant.toZonedDateTimeISO(temporalBinding.timezone);

    let nextDay = false;
    let minutes = getSqlServerMinutesFromTemporalZdt(zdt);

    if (minutes === 1440) {
        minutes = 0;
        nextDay = true;
    }

    // write days
    buffer.writeUInt16LE(getDaysSince1900DayOneFromTemporalZdt(zdt) + (nextDay ? 1 : 0), 0);
    // write minutes
    buffer.writeUInt16LE(minutes, 2);
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

export default SmallDateTimeTemporal;
module.exports = SmallDateTimeTemporal;
