import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://zxcyyxfptwvkocqvqryy.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4Y3l5eGZwdHd2a29jcXZxcnl5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0MTI3NCwiZXhwIjoyMDkwODE3Mjc0fQ.QrXFpBxeo2pPZd8wy9Ci1LYf8CD9V69u4B1vzxe1qqY"
);

const RAW = `Oasis Manchester\tHeaton Park\tSunday, July 20, 2025\t#7-44429/UK7\tAustin\tTicketmaster UK\tKempton.business@gmail.com\tStanding\t\t\t\t2\t£713.15\t£356.58\tsold\t2\t0\t£1,000.00\tYes\tYes\t£1,000.00\t£286.85\t40.22%\t
Drake\tCoop Live Manchester \tSaturday, July 26, 2025\t8-40737/UK4\t...\tTicketmaster UK\tKemptonCameron9x@gmail.com\t\t\t\t\t1\t£112.45\t£112.45\tSold\t1\t0\t£80.00\tYes\tYes\t£80.00\t-£32.45\t-28.86%\t
PAUL McCARTNEY\tAlamodome — San Antonio, Texas\tSaturday, October 25, 2025\t6-13430/DL2\t\tTicketmaster US\tKemptonCameron9x@gmail.com\t339\t22\t22\t23\t2\t£169.09\t£84.55\tSold\t2\t0\t£70.40\tYes\tYes\t£70.40\t-£98.69\t-58.37%\t
PAUL McCARTNEY\tAlamodome — San Antonio, Texas\tSaturday, October 25, 2025\t56-13085/DL\t\tTicketmaster US\tKemptonCameron9x@gmail.com\t343\t15\t5\t6\t2\t£169.09\t£84.55\tSold\t2\t0\t£70.40\tYes\tYes\t£70.40\t-£98.69\t-58.37%\t
COLDPLAY\tWembley Stadium\tWednesday, August 27, 2025\t17962209\t621087472\tTicketmaster UK\tKemptonhem@gmail.com\t550\t23\t308\t308\t1\t£70.30\t£70.30\tSold\t1\t0\t£140.00\tYes\tYes\t£140.00\t£69.70\t99.15%\t
Hans Zimmer\tO2\tSunday, November 30, 2025\t7-48034/UK1\t\tHarley\tKemptonCameron9x@gmail.com\t417\tU\t858\t859\t2\t£300.00\t£150.00\tSold\t2\t0\t£411.84\tYes\tYes\t£411.84\t£111.84\t37.28%\t
GORILLAZ\tLeeds First Direct Bank Arena\tWednesday, March 25, 2026\t26-28982/UK5\t10426176339\tTicketmaster UK\tKemptonCameron9x@gmail.com\tStanding\t\t\t\t4\t£404.75\t£101.19\tSold\t4\t0\t£344.96\tYes\tNo\tFALSE\t-£59.79\t-14.77%\t
COLDPLAY\tWembley Stadium\tTuesday, August 26, 2025\tMolly\t621204318\tTicketmaster UK\tMollyDorsi@icloud.com\t524\t35\t304\t305\t2\t£170.00\t£85.00\tSold\t2\t0\t£290.00\tYes\tYes\t£290.00\t£120.00\t70.59%\t
COLDPLAY\tWembley Stadium\tSaturday, August 23, 2025\t11-28485/UK8\t621275283\tTicketmaster UK\tKemptonCameron9x@gmail.com\t547\t13\t230\t231\t2\t£110.00\t£55.00\tSold\t2\t0\t£191.00\tYes\tYes\t£191.00\t£81.00\t73.64%\t
COLDPLAY\tWembley Stadium\tWednesday, September 3, 2025\t25-26064/UK8\t10096998507\tTicketmaster UK\tKemptonCameron9x@gmail.com\t232\t14\t124\t126\t3\t£291.50\t£97.17\tSold\t3\t0\t£401.26\tYes\tYes\t£401.26\t£109.76\t37.65%\t
COLDPLAY\tWembley Stadium\tWednesday, August 27, 2025\t11-46770/UK8\t106247835\tTicketmaster UK\tKemptonCameron9x@gmail.com\t232\t9\t124\t124\t1\t£99.00\t£99.00\tSold\t1\t0\t£130.00\tYes\tYes\t£130.00\t£31.00\t31.31%\t
OLIVIA DEAN\tO2 - London\tWednesday, April 29, 2026\t1017101029\t622128994\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t5\t£366.50\t£73.30\tSold\t5\t0\t£530.00\tNo\tNo\tFALSE\t£163.50\t44.61%\t
BAD BUNNY\tPuerto Rico \tFriday, September 5, 2025\tSMNE2V94\t10166943549\tTicketera\tKemptonCameron9x@gmail.com\t104A\tZ\t8\t8\t1\t£144.00\t£144.00\tSold\t1\t0\t£178.00\tYes\tYes\t£178.00\t£34.00\t23.61%\t
COLDPLAY\tWembley Stadium\tThursday, September 4, 2025\tChloe Fitton\t10176317853\tTicketmaster UK\tKemptonCameron9x@gmail.com\t503\t31\t77\t78\t2\t£200.00\t£100.00\tSold\t2\t0\t£297.40\tYes\tYes\t£297.40\t£97.40\t48.70%\t
OLIVIA DEAN\tO2 - London\tFriday, May 1, 2026\t63-32387/UK1\t10173015985\tTicketmaster UK\tKempton.cameronn@gmail.com\t108\tU\t235\t235\t1\t£85.95\t£85.95\tSold\t1\t0\t£163.68\tNo\tNo\tFALSE\t£77.73\t90.44%\t
OLIVIA DEAN\tO2 - London\tSaturday, May 2, 2026\t63-32262/UK1\t10190384460\tTicketmaster UK\tKempton.cameronn@gmail.com\t414\tL\t770\t770\t1\t£69.10\t£69.10\tSold\t1\t0\t£176.00\tNo\tNo\tFALSE\t£106.90\t154.70%\t
Washington Commanders vs. Miami Dolphins\tBernabéu - Madrid\tSunday, November 16, 2025\t00047937\t\tnfl.tmtickets\tKemptonCameron9x@gmail.com\t621, 4\t8\t1\t3\t2\t£161.00\t£80.50\tSold\t2\t0\t£274.00\tYes\tYes\t£274.00\t£113.00\t70.19%\t
Washington Commanders vs. Miami Dolphins\tBernabéu - Madrid\tMonday, November 17, 2025\t00047937\t\tnfl.tmtickets\tKemptonCameron9x@gmail.com\t621, 5\t8\t13\t15\t2\t£161.00\t£80.50\tSold\t2\t0\t£285.12\tYes\tYes\t£285.12\t£124.12\t77.09%\t
OLIVIA DEAN\tCo-op Live Manchester \tSunday, April 26, 2026\t18153144\t\tTicketmaster UK\tKempton.cameronn@gmail.com\t309\t18\t238\t239\t2\t£132.03\t£66.02\tSold\t2\t0\t£255.20\tNo\tNo\tFALSE\t£123.17\t93.29%\t
Hans Zimmer\tO2 - London\tSunday, November 30, 2025\tApp\t10198532856\tAxs\tKemptonCameron9x@gmail.com\tB1\tL\t5\t6\t2\t£314.00\t£157.00\tSold\t2\t0\t£610.00\tYes\tYes\t£610.00\t£296.00\t94.27%\t
OLIVIA DEAN\tO2 - London\tThursday, April 30, 2026\tApp\t10216525765\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t1\t£90.09\t£90.09\tSold\t1\t0\t£166.32\tNo\tNo\tFALSE\t£76.23\t84.62%\t
FLORENCE + THE MACHINE\tO2 - London\tMonday, February 16, 2026\t1017147993\t10231719621\tAXS\tKemptonCameron9x@gmail.com\t408\tR\t637\t640\t4\t£189.60\t£47.40\tSold\t4\t0\t£362.56\tYes\tYes\t£362.56\t£172.96\t91.22%\t
FLORENCE + THE MACHINE\tO2 - London\tTuesday, February 17, 2026\t1017147788\t10231734569\tAXS\tKemptonCameron9x@gmail.com\tStanding\t\t\t\t2\t£139.80\t£69.90\tSold\t2\t0\t£239.36\tYes\tYes\t£239.36\t£99.56\t71.22%\t
FLORENCE + THE MACHINE\tO2 - London\tTuesday, February 17, 2026\t1017147717\t10231745398\tAXS\tKemptonCameron9x@gmail.com\t404\tA\t545\t546\t2\t£134.80\t£67.40\tSold\t2\t0\t£235.00\tYes\tYes\t£235.00\t£100.20\t74.33%\t
GORILLAZ\tUtilita Arena Cardiff\tFriday, March 27, 2026\t52-28984/UK3\t10426172539\tTicketmaster UK\tKemptonCameron9x@gmail.com\tStanding\t\t\t\t4\t£393.95\t£98.49\tSold\t4\t0\t£474.60\tYes\tNo\tFALSE\t£80.65\t20.47%\t
OLIVIA DEAN\tO2 - London\tWednesday, April 29, 2026\tApp\t10216569168\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t1\t£79.75\t£79.75\tSold\t1\t0\t£154.88\tNo\tNo\tFALSE\t£75.13\t94.21%\t
OLIVIA DEAN\tO2 - London\tThursday, April 30, 2026\tApp\t10216525765\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t2\t£159.50\t£79.75\tSold/Listed\t1\t-1\t£166.32\tNo\tNo\tFALSE\t£6.82\t4.28%\tSold wrong
OLIVIA DEAN\tO2 - London\tThursday, April 30, 2026\tApp\t10216525765\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t2\t£180.18\t£90.09\tSold\t2\t0\t£332.64\tNo\tNo\tFALSE\t£152.46\t84.62%\t
Hans Zimmer\tO2 - London\tMonday, December 1, 2025\tApp\t10226036622\tAXS\tKemptonCameron9x@gmail.com\t407\tM\t615\t620\t6\t£641.28\t£106.88\tSold\t6\t0\t£1,040.00\tYes\tYes\t£1,040.00\t£398.72\t62.18%\t
Die Hamburger Goldkehlchen\tElbphilharmonie Großer Saal\tWednesday, December 17, 2025\tEmails\t\telbphilharmonie\tKemptonCameron9x@gmail.com\t16W\t1\t12\t15\t4\t£100.73\t£25.18\tSold\t4\t0\t£608.96\tYes\tYes\t£608.96\t£508.23\t504.55%\t
FLORENCE + THE MACHINE\tCo-op Live Manchester \tFriday, February 20, 2026\t56-45390/UK4\t10231766195\tTicketmaster UK\tKempton.business@gmail.com\tStanding\t\t\t\t4\t£319.90\t£79.98\tSold\t4\t0\t£492.80\tYes\tYes\t£492.80\t£172.90\t54.05%\t
Ariana Grande\tAmerant Bank Arena, Sunrise, FL\tThursday, July 2, 2026\tN4Q-7Y2N9MR\t\tSeatgeek\tkemptoncart2@gmail.com\t102\t13\t9\t12\t4\t£979.79\t£244.95\tSold\t4\t0\t£2,112.00\tYes\tNo\tFALSE\t£1,132.21\t115.56%\t
Ariana Grande\tAmerant Bank Arena, Sunrise, FL\tThursday, July 2, 2026\tN4Q-6P2L8PZ\t\tSeatgeek\tkemptoncart2@gmail.com\t320\t9\t5\t6\t2\t£200.53\t£100.27\tSold\t2\t0\t£616.00\tYes\tNo\tFALSE\t£415.47\t207.19%\t
The Weeknd\tWembley Stadium\tFriday, August 14, 2026\t20-10243/UK8\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\t105\t39\t66\t67\t2\t£246.65\t£123.33\tPersonal\t-2\t\t\tNo\tNo\tFALSE\t-£246.65\t-100.00%\t
The Weeknd\tWembley Stadium\tFriday, August 14, 2026\t20-10337/UK8\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\tGolden Circle South\t\t\t\t2\t£355.45\t£177.73\tSold\t2\t0\t£475.00\tNo\tNo\tFALSE\t£119.55\t33.63%\t
The Weeknd\tWembley Stadium\tFriday, August 14, 2026\t20-10480/UK8\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\tGolden Circle North\t\t\t\t2\t£355.45\t£177.73\tSold\t2\t0\t£442.64\tNo\tNo\tFALSE\t£87.19\t24.53%\t
Radiohead\tO2 - London\tTuesday, November 25, 2025\t1017214611\t10398539090\tAXS\toxidant.gem0l@icloud.com\tGA\t\t\t\t4\t£392.30\t£98.08\tSold\t4\t0\t£2,036.32\tYes\tYes\t£2,036.32\t£1,644.02\t419.07%\t
Radiohead\tUnipol Arena - Italy\tMonday, November 17, 2025\t3365750\t10398566051\tTicketmaster IT\tKempton623@gmail.com\tGA\t\t\t\t4\t£430.25\t£107.56\tSold\t4\t0\t£1,022.56\tYes\tYes\t£1,022.56\t£592.31\t137.67%\t
GORILLAZ\tM&S Bank Arena, Liverpool\tSunday, March 29, 2026\t20-42144/UK4\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\tBL15\tM\t405\t406\t2\t£203.85\t£101.93\tSold\t2\t0\t£352.00\tYes\tNo\tFALSE\t£148.15\t72.68%\t
ZAYN\tDolby Live — Las Vegas, Nevada\tSunday, January 25, 2026\t21-43615/NV2\t\tTicketmaster US\tkemptoncart2@gmail.com\tStanding\t\t\t\t2\t£191.00\t£95.50\tSold\t2\t0\t£168.96\tYes\tYes\t£168.96\t-£22.04\t-11.54%\t
ZAYN\tDolby Live — Las Vegas, Nevada\tSunday, January 25, 2026\t21-43317/NV2\t\tTicketmaster US\tKempton.cameronn@gmail.com\tStanding\t\t\t\t4\t£393.42\t£98.36\tSold\t4\t0\t£351.12\tYes\tYes\t£351.12\t-£42.30\t-10.75%\t
SYSTEM OF A DOWN\tTottenham Hotspur Stadium, London\tWednesday, July 15, 2026\t28-44073/UK1\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\t325\t66\t311\t314\t4\t£441.95\t£110.49\tListed\t-4\t\t\tNo\tNo\tFALSE\t-£441.95\t-100.00%\t
SYSTEM OF A DOWN\tTottenham Hotspur Stadium, London\tWednesday, July 15, 2026\t28-43662/UK1\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\tStanding\t\t\t\t2\t£331.35\t£165.68\tSold\t2\t0\t£397.76\tNo\tNo\tFALSE\t£66.41\t20.04%\t
RAYE\tOVO Hydro, Glasgow\tSaturday, February 21, 2026\t14-55184/UK3\t10426142896\tTicketmaster UK\tKemptonCameron9x@gmail.com\t334\tBB\t324\t327\t4\t£221.90\t£55.48\tSold\t4\t0\t£466.40\tYes\tNo\tFALSE\t£244.50\t110.18%\t
Gunna\tAO Arena - Manchester\tThursday, March 26, 2026\t5-54056/UK5\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tBL 108 \tF\t9\t11\t3\t£181.95\t£60.65\tSold\t2\t-1\t£244.64\tYes\tNo\tFALSE\t£62.69\t34.45%\t
RAYE\tbp pulse LIVE, Birmingham\tTuesday, February 24, 2026\t21-36913/UK8\t10398524512\tTicketmaster UK\tKemptonCameron9x@gmail.com\tBLK 9\tZD\t273\t276\t4\t£200.15\t£50.04\tSold\t4\t0\t£316.80\tYes\tNo\tFALSE\t£116.65\t58.28%\t
Swedish House Mafia\tPier 80, San Francisco\tWednesday, December 31, 2025\t46579203\t\tAXS\tKemptonCameron9x@gmail.com\tGA2\t\t\t\t6\t£607.89\t£101.32\tSold\t6\t0\t£818.40\tYes\tYes\t£818.40\t£210.51\t34.63%\t
LUDOVICO EINAUDI\tUsher Hall, Edinburgh\tSaturday, April 25, 2026\t27-59940/UK3\t10426130627\tTicketmaster UK\tKempton.cameronn@gmail.com\tSTALLS\tF\t12\t13\t2\t£225.00\t£112.50\tSold\t2\t0\t£237.60\tNo\tNo\tFALSE\t£12.60\t5.60%\t
My Chemical Romance\tHollywood Bowl — Hollywood, California\tWednesday, October 21, 2026\t35-37272/LA2\t\tTicketmaster US\tKempton.cameronn@gmail.com\tSEC U2\t9\t111\t114\t4\t£0\t£0\tListed\t-4\t\t\tNo\tNo\tFALSE\t£0\t\t
My Chemical Romance\tWembley Stadium\tFriday, July 10, 2026\tRE18394623\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tFront Standing\t\t\t\t1\t£143.15\t£143.15\tSold\t1\t0\t£168.96\tNo\tNo\tFALSE\t£25.81\t18.03%\t
Tame Impala\tCoop Live Manchester \tFriday, May 8, 2026\t121129121\t\tGigsAndTours\tMollyDorsi@icloud.com\t304\t15\t88\t91\t4\t£305.40\t£76.35\tSold\t4\t0\t£422.40\tNo\tNo\tFALSE\t£117.00\t38.31%\t
Tame Impala\tCoop Live Manchester \tFriday, May 8, 2026\t121131829\t\tGigsAndTours\tKemptonCameron9x@gmail.com\t302\t11\t42\t43\t2\t£154.60\t£77.30\tSold\t2\t0\t£211.20\tNo\tNo\tFALSE\t£56.60\t36.61%\t
Tame Impala\tO2 - London\tThursday, May 7, 2026\t121132477\t\tGigsAndTours\tKemptonCameron9x@gmail.com\t410\tP\t691\t692\t2\t£176.50\t£88.25\tSold\t2\t0\t£211.20\tNo\tNo\tFALSE\t£34.70\t19.66%\t
Tame Impala\tO2 - London\tThursday, May 7, 2026\t121132911\t\tGigsAndTours\tKemptonCameron9x@gmail.com\t414\tN\t766\t769\t4\t£350.40\t£87.60\tSold\t4\t0\t£459.36\tNo\tNo\tFALSE\t£108.96\t31.10%\t
Radiohead\tO2 - London\tMonday, November 24, 2025\t625494606\t\tViagogo \tKemptonCameron9x@gmail.com\t113\tU\t423\t424\t2\t£594.41\t£297.21\tSold\t2\t0\t£878.00\tYes\tYes\t£878.00\t£283.59\t47.71%\t
PITBULL\tHyde Park - London\tFriday, July 10, 2026\t1080950037\t\tAXS\tkemptoncart2@gmail.com\tGA\t\t\t\t4\t£368.80\t£92.20\tSold\t4\t0\t£461.00\tNo\tNo\tFALSE\t£92.20\t25.00%\t
OLIVIA DEAN\tO2 - London\tSaturday, May 2, 2026\tApp\t\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t2\t£180.18\t£90.09\tSold\t2\t0\t£309.76\tNo\tNo\tFALSE\t£129.58\t71.92%\t
OLIVIA DEAN\tCo-op Live Manchester \tSunday, April 26, 2026\tRE18519727\t\tTicketmaster UK\tKempton.cameronn@gmail.com\t311\t14\t279\t280\t2\t£158.39\t£79.20\tSold\t2\t0\t£616.00\tNo\tNo\t\t£457.61\t288.91%\t
Gunna\tO2 - London\tWednesday, March 25, 2026\t1017501476\t\tAXS\tKemptonCameron9x@gmail.com\t405\tT\t567\t568\t2\t£115.60\t£57.80\tSold\t2\t0\t£174.24\tYes\tNo\tFALSE\t£58.64\t50.73%\t
Gunna\tO2 - London\tWednesday, March 25, 2026\t1017504457\t\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t2\t£193.70\t£96.85\tSold\t2\t0\t£299.20\tYes\tNo\tFALSE\t£105.50\t54.47%\t
Gunna\tO2 - London\tWednesday, March 25, 2026\t1017504778\t\tAXS\tKemptonCameron9x@gmail.com\t402\tL\t492\t494\t3\t£172.15\t£57.38\tSold\t3\t0\t£293.04\tYes\tNo\tFALSE\t£120.89\t70.22%\t
FLORENCE + THE MACHINE\tO2 - London\tMonday, February 16, 2026\t64-24682/UK1\t10231754546\tTicketmaster UK\tKemptonCameron9x@gmail.com\t420\tN\t935\t937\t3\t£235.00\t£78.33\tSold\t3\t0\t£327.36\tYes\tYes\t£327.36\t£92.36\t39.30%\t
Gunna\tAO Arena - Manchester\tThursday, March 26, 2026\t1160185362\t\tAXS\tKemptonCameron9x@gmail.com\t110\tR\t6\t7\t2\t£124.65\t£62.33\tSold\t2\t0\t£223.52\tYes\tNo\tFALSE\t£98.87\t79.32%\t
Luke Combs\tWembley Stadium\tFriday, July 31, 2026\t1023484711\t\tAxs\tKemptonCameron9x@gmail.com\tFront Standing\t\t\t\t4\t£594.50\t£148.63\tSold\t4\t0\t£682.88\tNo\tNo\tFALSE\t£88.38\t14.87%\t
Luke Combs\tScottish Gas Murrayfield, Edinburgh\tSaturday, July 25, 2026\t58-49205/UK3\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tW8\tAA\t31\t32\t2\t£213.85\t£106.93\tSold\t2\t0\t£300.00\tNo\tYes\t£300.00\t£86.15\t40.29%\t
NBA London\tO2 - London\tSunday, January 18, 2026\t1017558699\t\tAXS\tKemptonCameron9x@gmail.com\t402\tN\t491\t493\t3\t£482.50\t£160.83\tSold\t3\t0\t£976.00\tYes\tYes\t£976.00\t£493.50\t102.28%\t
Hans Zimmer\tO2 - London\tMonday, December 1, 2025\tAPP\t\tAXS\tKemptonCameron9x@gmail.com\t419\tH\t904\t905\t2\t£279.68\t£139.84\tSold\t2\t0\t£311.52\tYes\tYes\t£311.52\t£31.84\t11.38%\t
Hans Zimmer\tO2 - London\tSunday, November 30, 2025\tAPP\t\tAxs\tKemptonCameron9x@gmail.com\t110\tB\t5\t6\t2\t£225.00\t£112.50\tSold\t2\t0\t£520.96\tYes\tYes\t£520.96\t£295.96\t131.54%\t
Hans Zimmer\tO2 - London\tMonday, December 1, 2025\tAPP\t\tAxs\tKemptonCameron9x@gmail.com\t403\tG\t513\t514\t2\t£270.00\t£135.00\tSold\t2\t0\t£270.00\tYes\tYes\t£270.00\t£0\t0.00%\t
Radiohead\tO2 - London\tTuesday, November 25, 2025\tAPP\t\tAxs\tKemptoncameron9x@gmail.com\t112\tD\t363\t364\t2\t£712.80\t£356.40\tSold\t2\t0\t£1,056.00\tYes\tYes\t£1,056.00\t£343.20\t48.15%\t
OLIVIA DEAN\tO2 - London\tWednesday, April 29, 2026\tAPP\t\tAxs\tKemptonCameron9x@gmail.com\t408\tB\t623\t625\t3\t£245.70\t£81.90\tSold\t3\t0\t£588.72\tNo\tNo\tFALSE\t£343.02\t139.61%\t
Olivia DEAN\tO2 - London\tWednesday, April 29, 2026\tAPP\t\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t1\t£78.75\t£78.75\tListed\t-1\t\t\tNo\tNo\tFALSE\t-£78.75\t-100.00%\t
Bon Jovi\tWembley Stadium\tFriday, September 4, 2026\t60-36165/UK8\t\tTicketmaster UK\tKemptoncart1@gmail.com\t106\t42\t98\t103\t6\t£727.05\t£121.18\tSold\t6\t0\t£1,329.00\tNo\tNo\tFALSE\t£601.95\t82.79%\t
Bon Jovi\tScottish Gas Murrayfield, Edinburgh\tFriday, August 28, 2026\t42-42287/UK3\t\tTicketmaster UK\tKemptoncart1@gmail.com\tW9\tD\t1\t5\t5\t£606.20\t£121.24\tSold/Listed\t2\t-3\t£616.00\tNo\tNo\tFALSE\t£9.80\t1.62%\t
5SOS\tThe O2, London\tThursday, April 2, 2026\t34-36663/UK1\t\tTicketmaster UK\tKemptoncart1@gmail.com\t105\tY\t143\t146\t4\t£307.70\t£76.93\tSold\t4\t0\t£186.56\tNo\tNo\tFALSE\t-£121.14\t-39.37%\t
Dave\tThe O2, London\tSaturday, March 7, 2026\tAPP\t\tAxs\tMollyDorsi@icloud.com\t407\tG\t604\t605\t2\t£115.00\t£57.50\tSold\t2\t0\t£140.00\tYes\tYes\t£140.00\t£25.00\t21.74%\t
Dave\tThe O2, London\tSaturday, March 7, 2026\tAPP\t\tTicketmaster\tKempton.cameronn@gmail.com\t406\tU\t575\t576\t2\t£139.35\t£69.68\tSold\t2\t0\t£147.84\tYes\tYes\t\t£8.49\t6.09%\t
Dave\tThe O2, London\tSaturday, March 7, 2026\tAPP\t\tAxs\tMollyDorsi@icloud.com\t410\tC\t691\t692\t2\t£115.00\t£57.50\tSold\t2\t0\t£176.00\tYes\tYes\t£176.00\t£61.00\t53.04%\t
Dave\tThe O2, London\tSaturday, March 7, 2026\tAPP\t\tAxs\tMollyDorsi@icloud.com\t412\tA\t721\t723\t3\t£172.50\t£57.50\tSold\t3\t0\t£234.96\tYes\tYes\t£234.96\t£62.46\t36.21%\t
RÜFÜS DU SOL\tThe O2, London\tWednesday, May 13, 2026\t10-55518/UK1\t\tTicketmaster UK\tKemptonXX@gmail.com\tGA\t\t\t\t2\t£157.23\t£78.62\tSold\t2\t0\t£232.32\tNo\tNo\tFALSE\t£75.09\t47.76%\t
Hans Zimmer\tThe O2, London\tMonday, December 1, 2025\tApp\t\tAXS\tKemptonCameron9x@gmail.com\tB2\tD\t26\t26\t1\t£90.00\t£90.00\tSold\t1\t0\t£215.60\tYes\tYes\t£215.60\t£125.60\t139.56%\t
Hans Zimmer\tThe O2, London\tMonday, December 1, 2025\tApp\t\tAXS\tKemptonCameron9x@gmail.com\t108\tK\t226\t227\t2\t£254.92\t£127.46\tSold\t2\t0\t£254.92\tYes\tYes\t£254.92\t£0\t0.00%\t
Zack Top\tGrand Garden Arena - Vegas\tFriday, December 12, 2025\t36996854\t\tAXS\tKemptonhem@gmail.com\t219\tR\t3\t6\t4\t£211.61\t£52.90\tSold\t4\t0\t£216.48\tYes\tYes\t£216.48\t£4.87\t2.30%\t
Hans Zimmer\tO2 - London\tSunday, November 30, 2025\tAPP\t\tAxs\tKemptonCameron9x@gmail.com\t411\tN\t713\t714\t2\t£254.92\t£127.46\tSold\t2\t0\t£254.92\tYes\tYes\t£254.92\t£0\t0.00%\t
Hans Zimmer\tO2 - London\tSunday, November 30, 2025\tAPP\t\tAxs\tKemptonCameron9x@gmail.com\tB2\tR\t29\t32\t4\t£510.90\t£127.73\tSold\t4\t0\t£556.00\tYes\tYes\t£556.00\t£45.10\t8.83%\t
Hans Zimmer\tO2 - London\tSunday, November 30, 2025\tAPP\t\tAxs\tKemptonCameron9x@gmail.com\tB2\tT\t21\t24\t4\t£510.90\t£127.73\tSold\t4\t0\t£556.00\tYes\tYes\t£556.00\t£45.10\t8.83%\t
Los Angeles Lakers vs. Phoenix Suns\tCrypto Arena\tFriday, April 10, 2026\tTM\t\tTicketmaster US\tKempton.cameronn@gmail.com\t\t\t\t\t2\t£219.36\t£109.68\tSold\t2\t0\t£160.16\tNo\tNo\tFALSE\t-£59.20\t-26.99%\t
Bruno Mars\tWembley Stadium\tSunday, July 19, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\t550\t9\t322\t324\t3\t£263.55\t£87.85\tSold\t3\t0\t£456.72\tNo\tNo\tFALSE\t£193.17\t73.30%\t
Bruno Mars\tWembley Stadium\tSunday, July 19, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\t114\t39\t79\t80\t2\t£312.35\t£156.18\tSold\t2\t0\t£596.64\tNo\tNo\tFALSE\t£284.29\t91.02%\t
Bruno Mars\tWembley Stadium\tSunday, July 19, 2026\t\t\tTicketmaster UK\tKemptonhem@gmail.com\tGC\t\t\t\t6\t£963.00\t£160.50\tSold\t6\t0\t£1,777.60\tNo\tNo\tFALSE\t£814.60\t84.59%\t
Bruno Mars\tWembley Stadium\tSunday, July 19, 2026\t\t\tTicketmaster UK\tKemptonhem@gmail.com\t505\t25\t138\t143\t6\t£444.85\t£74.14\tSold\t6\t0\t£739.20\tNo\tNo\tFALSE\t£294.35\t66.17%\t
BTS\tAllianz Arena\tSaturday, July 11, 2026\t\t\tTicketmaster DE\tkemptoncart2@gmail.com\tGA\t\t\t\t4\t£631.61\t£157.90\tSold\t4\t0\t£1,158.08\tNo\tNo\tFALSE\t£526.47\t83.35%\t
BTS\tAllianz Arena\tSunday, July 12, 2026\t\t\tTicketmaster DE\tkemptoncart2@gmail.com\tGA\t\t\t\t4\t£631.61\t£157.90\tSold\t4\t0\t£1,001.44\tNo\tNo\tFALSE\t£369.83\t58.55%\t
BTS\tTottenham Hotspur Stadium, London\tMonday, July 6, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tNorth GA\t\t\t\t4\t£681.25\t£170.31\tSold\t4\t0\t£1,636.80\tYes\tNo\tFALSE\t£955.55\t140.26%\t
BTS\tTottenham Hotspur Stadium, London\tTuesday, July 7, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tNorth GA\t\t\t\t4\t£681.25\t£170.31\tSold\t4\t0\t£1,766.16\tYes\tNo\tFALSE\t£1,084.91\t159.25%\t
BTS\tSun Bowl Stadium - El Paso, TX\tSaturday, May 2, 2026\t\t\tTicketmaster US\tkemptoncart2@gmail.com\t22\t76\t27\t30\t4\t£277.46\t£69.37\tSold\t4\t0\t£827.20\tYes\tNo\tFALSE\t£549.74\t198.13%\t
BTS\tSun Bowl Stadium - El Paso, TX\tSunday, May 3, 2026\t\t\tTicketmaster US\tkemptoncart2@gmail.com\t22\t75\t27\t30\t4\t£277.46\t£69.37\tSold\t4\t0\t£642.40\tYes\tNo\tFALSE\t£364.94\t131.53%\t
BTS\tEstadio Riyadh Air Metropolitano\tSaturday, June 27, 2026\t\t\tTicketmaster ES\tkemptoncart2@gmail.com\t122\t26\t16\t19\t4\t£933.11\t£233.28\tSold\t4\t0\t£1,549.20\tNo\tNo\tFALSE\t£616.09\t66.03%\t
BTS\tEstadio Riyadh Air Metropolitano\tFriday, June 26, 2026\t\t\tTicketmaster ES\tkemptoncart2@gmail.com\t122\t29\t17\t20\t4\t£933.11\t£233.28\tSold\t4\t0\t£1,339.36\tNo\tNo\tFALSE\t£406.25\t43.54%\t
BTS\tAT&T Stadium ARLINGTON\tSunday, August 16, 2026\t\t\tSeatgeek\tKemptonCameron9x@gmail.com\t314\t7\t8\t11\t4\t£632.00\t£158.00\tSold\t2\t-2\t£1,126.40\tNo\tNo\tFALSE\t£494.40\t78.23%\t
BTS\tEstadio GNP Seguros - Ciudad de México, CDMX\tThursday, May 7, 2026\t\t\tTicketmaster MX\tKemptonCameron9x@gmail.com\tPlat33\t20\t11\t12\t2\t£723.24\t£361.62\tSold\t2\t0\t£1,566.40\tNo\tNo\tFALSE\t£843.16\t116.58%\t
Tomorrowland W1: Glorious Sunday Pass\tDe Schorre recreational park in Boom, Belgium\tSunday, July 19, 2026\t\t\tTomorrowland\tImpasto_spouted.44@icloud.com\tGA\t\t\t\t1\t£147.25\t£147.25\tUnlisted\t-1\t\t\tNo\tNo\tFALSE\t-£147.25\t-100.00%\t
FIFA WORLD CUP\t\tSunday, June 14, 2026\t\t\tFIFA\tKemptonCameron9x@gmail.com\tCAT 2\t\t\t\t2\t£628.44\t£314.22\tUnlisted\t-2\t\t\tNo\tNo\tFALSE\t-£628.44\t-100.00%\t
FIFA WORLD CUP\t\tSunday, June 21, 2026\t\t\tFIFA\tKemptonCameron9x@gmail.com\tCAT 2\t\t\t\t2\t£628.44\t£314.22\tUnlisted\t-2\t\t\tNo\tNo\tFALSE\t-£628.44\t-100.00%\t
FIFA WORLD CUP\t\tMonday, June 22, 2026\t\t\tFIFA\tKemptonCameron9x@gmail.com\tCAT 2\t\t\t\t2\t£628.44\t£314.22\tUnlisted\t-2\t\t\tNo\tNo\tFALSE\t-£628.44\t-100.00%\t
Harry Styles\tWembley Stadium\tFriday, June 12, 2026\t\t\tTicketmaster UK\tKemptonCameron9x@gmail.com\tKiss\t\t\t\t2\t£559.00\t£279.50\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£559.00\t-100.00%\t
Olivia DEAN\tO2 - London\tWednesday, April 29, 2026\tAPP\t\tAXS\tKemptonCameron9x@gmail.com\tGA\t\t\t\t2\t£157.50\t£78.75\tSold\t2\t0\t£756.80\tNo\tNo\tFALSE\t£599.30\t380.51%\t
BBC Radio 1 Saturday\t\tSaturday, May 23, 2026\t\t\tTicketmaster UK\tngothikimlinh144@gmail.com\tGA\t\t\t\t1\t£44.50\t£44.50\tUnlisted\t-1\t\t\tNo\tNo\tFALSE\t-£44.50\t-100.00%\t
BBC Radio 1 Saturday\t\tSaturday, May 23, 2026\t\t\tTicketmaster UK\tnguyenthithuba461@gmail.com\tGA\t\t\t\t1\t£44.50\t£44.50\tUnlisted\t-1\t\t\tNo\tNo\tFALSE\t-£44.50\t-100.00%\t
BBC Radio 1 Saturday\t\tSaturday, May 23, 2026\t\t\tTicketmaster UK\tkekerek3@gmail.com\tGA\t\t\t\t1\t£44.50\t£44.50\tUnlisted\t-1\t\t\tNo\tNo\tFALSE\t-£44.50\t-100.00%\t
BBC Radio 1 Sunday\t\tSunday, May 24, 2026\t\t\tTicketmaster UK\tnguyenthithuba461@gmail.com\tGA\t\t\t\t2\t£89.00\t£44.50\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£89.00\t-100.00%\t
BBC Radio 1 Sunday\t\tSunday, May 24, 2026\t\t\tTicketmaster UK\tkekerek3@gmail.com\tGA\t\t\t\t2\t£89.00\t£44.50\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£89.00\t-100.00%\t
BBC Radio 1 Sunday\t\tSunday, May 24, 2026\t\t\tTicketmaster UK\temreetrabzon@gmail.com\tGA\t\t\t\t2\t£89.00\t£44.50\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£89.00\t-100.00%\t
BBC Radio 1 Sunday\t\tSunday, May 24, 2026\t\t\tTicketmaster UK\tan810302@gmail.com\tGA\t\t\t\t2\t£89.00\t£44.50\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£89.00\t-100.00%\t
BBC Radio 1 Sunday\t\tSunday, May 24, 2026\t\t\tTicketmaster UK\tlethithutrinh95@gmail.com\tGA\t\t\t\t2\t£89.00\t£44.50\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£89.00\t-100.00%\t
Bon Jovi\t\tFriday, September 4, 2026\t\t\tTicketmaster UK\tnguyenthihongdanh98@gmail.com\t126\t23\t91\t96\t6\t£727.05\t£121.18\tListed\t-6\t\t\tNo\tNo\tFALSE\t-£727.05\t-100.00%\t
Alex Warren\tOVO Hydro\tSunday, April 26, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\t238\tRow\t411\t412\t2\t£155.51\t£77.76\tSold\t2\t0\t£264.00\tNo\tNo\tFALSE\t£108.49\t69.76%\t
Olivia Dean\tMarlay Park\tSaturday, June 20, 2026\t\t\tTicketmaster IE\tkemptoncart2@gmail.com\tGA\t\t\t\t2\t£172.52\t£86.26\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£172.52\t-100.00%\t
Olivia Dean\tMarlay Park\tSaturday, June 20, 2026\t\t\tTicketmaster IE\tkemptoncart2@gmail.com\tGA\t\t\t\t1\t£87.67\t£87.67\tListed\t-1\t\t\tNo\tNo\tFALSE\t-£87.67\t-100.00%\t
Olivia Dean\tMarlay Park\tSaturday, June 20, 2026\t\t\tTicketmaster IE\tkemptoncart2@gmail.com\tGA\t\t\t\t2\t£172.52\t£86.26\tListed\t-2\t\t\tNo\tNo\tFALSE\t-£172.52\t-100.00%\t
Clara La San\tXOYO Birmingham \tWednesday, April 8, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tGA\t\t\t\t1\t£31.66\t£31.66\tSold\t1\t0\t£65.12\tNo\tNo\tFALSE\t£33.46\t105.69%\t
Clara La San\tElectric Bristol\tSaturday, April 4, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tGA\t\t\t\t2\t£65.35\t£32.68\tSold\t2\t0\t£59.84\tNo\tNo\tFALSE\t-£5.51\t-8.43%\t
Clara La San\tElectric Bristol\tSaturday, April 4, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tGA\t\t\t\t2\t£65.35\t£32.68\tSold\t2\t0\t£65.12\tNo\tNo\tFALSE\t-£0.23\t-0.35%\t
Bruno Mars\tWembley Stadium\tSunday, July 19, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\t551\t12\t339\t339\t1\t£99.91\t£99.91\tUnlisted\t-1\t\t\tNo\tNo\tFALSE\t-£99.91\t-100.00%\t
Tucker Wetmore\tManchester Academy\tFriday, April 24, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tGA\t\t\t\t2\t£83.75\t£41.88\tSold\t2\t0\t£126.72\tNo\tNo\tFALSE\t£42.97\t51.31%\t
Freddie Gibbs\tAlbert Hall\tTuesday, April 7, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tGA\t\t\t\t1\t£45.75\t£45.75\tSold\t1\t0\t£65.12\tNo\tNo\tFALSE\t£19.37\t42.34%\t
Tucker Wetmore\tO2 Forum Kentish Town\tThursday, April 30, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tBALC\t\t\t\t1\t£52.50\t£52.50\tListed\t-1\t\t\tNo\tNo\tFALSE\t-£52.50\t-100.00%\t
Tucker Wetmore\tO2 Forum Kentish Town\tTuesday, April 28, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tBALC\t\t\t\t1\t£49.25\t£49.25\tListed\t-1\t\t\tNo\tNo\tFALSE\t-£49.25\t-100.00%\t
Conan Gray\tThe O2\tTuesday, May 12, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\t406\tS\t575\t576\t2\t£134.69\t£67.35\tSold\t2\t0\t£158.40\tNo\tNo\tFALSE\t£23.71\t17.60%\t
Big Thief\tO2 Academy Brixton\tFriday, April 24, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tBLK8\tM\t51\t52\t2\t£95.25\t£47.63\tSold\t2\t0\t£137.28\tNo\tNo\tFALSE\t£42.03\t44.13%\t
The Cure\t\t\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\t\t\t\t\t3\t£274.39\t£91.46\tUnlisted\t-3\t\t\tNo\tNo\tFALSE\t-£274.39\t-100.00%\t
Clara La San\tElectric Brixton\tThursday, April 2, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tGA\t\t\t\t3\t£105.04\t£35.01\tSold\t3\t0\t£145.20\tYes\tNo\tFALSE\t£40.16\t38.23%\t
Freddie Gibbs\tAlbert Hall\tTuesday, April 7, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tGA\t\t\t\t3\t£123.97\t£41.32\tSold/Listed\t1\t-2\t£195.36\tNo\tNo\tFALSE\t£71.39\t57.59%\t
Tucker Wetmore\tO2 Academy Birmingham\tSunday, April 26, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tStalls\t\t\t\t2\t£95.91\t£47.96\tSold/Listed\t1\t-1\t£66.00\tNo\tNo\tFALSE\t-£29.91\t-31.19%\t
President\tO2 Ritz Manchester\tTuesday, April 14, 2026\t\t\tTicketmaster UK\tkemptoncart2@gmail.com\tGA\t\t\t\t2\t£62.33\t£31.17\tSold\t2\t0\t£93.28\tNo\tNo\tFALSE\t£30.95\t49.66%\t
Clara La San\tXOYO Birmingham\tWednesday, April 8, 2026\t\t\tTicketmaster UK\tKempton.cameronn@gmail.com\tGA\t\t\t\t1\t£30.51\t£30.51\tListed\t-1\t\t\tNo\tNo\tFALSE\t-£30.51\t-100.00%\t`;

function parseCurrency(val) {
  if (!val || val === "FALSE" || val === "") return null;
  const cleaned = val.replace(/£/g, "").replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseQty(val) {
  if (!val || val === "") return null;
  const num = parseInt(val, 10);
  return isNaN(num) || num < 0 ? null : num;
}

function normalizeStatus(val) {
  if (!val) return "Unlisted";
  const v = val.trim().toLowerCase();
  if (v === "sold") return "Sold";
  if (v === "listed") return "Listed";
  if (v === "sold/listed") return "Sold";
  if (v === "personal") return "Unlisted";
  return "Unlisted";
}

function clean(val) {
  return val?.trim() || null;
}

const rows = RAW.trim().split("\n").map((line, i) => {
  const cols = line.split("\t");
  const eventName = clean(cols[0]);
  const venue     = clean(cols[1]);
  const eventDate = clean(cols[2]);
  const bookingRef = clean(cols[3]);
  const sourceType = clean(cols[5]);
  const accountEmail = clean(cols[6])?.toLowerCase();
  const section   = clean(cols[7]);
  const row       = clean(cols[8]);
  const seatFrom  = clean(cols[9]);
  const seatTo    = clean(cols[10]);
  const qtyBought = parseQty(cols[11]);
  const totalCost = parseCurrency(cols[12]);
  const rawStatus = clean(cols[14]);
  const soldTotal = parseCurrency(cols[17]);
  const listingStatus = normalizeStatus(rawStatus);

  return {
    event_name: eventName,
    venue,
    event_date: eventDate,
    booking_ref: bookingRef ? `${bookingRef}-${i}` : `IMPORT-${i}`,
    user_id: "9d24a406-de4f-4e0c-9977-2eedb75ed857",
    source_type: sourceType,
    account_email: accountEmail,
    section,
    row,
    seat_from: seatFrom,
    seat_to: seatTo,
    qty_bought: qtyBought,
    total_cost: totalCost,
    sold_total: soldTotal,
    listing_status: listingStatus,
  };
}).filter(r => r.event_name);

console.log(`Parsed ${rows.length} rows. Inserting...`);

const { data, error } = await supabase.from("orders").insert(rows).select("id");

if (error) {
  console.error("Import failed:", error.message);
  process.exit(1);
}

console.log(`✓ Imported ${data.length} orders successfully.`);
