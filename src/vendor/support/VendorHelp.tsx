import { Route, Routes } from 'react-router-dom';
import { vendorScope } from '../../components/support/api';
import { NewTicket } from '../../components/support/NewTicket';
import { TicketList } from '../../components/support/TicketList';
import { TicketThread } from '../../components/support/TicketThread';
import { useVendor } from '../context';

/** /vendor/help: tickets filed for this business. */
export default function VendorHelp() {
  const scope = vendorScope(useVendor().id);
  return (
    <Routes>
      <Route index element={<TicketList scope={scope} />} />
      <Route path="new" element={<NewTicket scope={scope} />} />
      <Route path=":id" element={<TicketThread scope={scope} />} />
    </Routes>
  );
}
